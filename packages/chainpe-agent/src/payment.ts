/**
 * Payment Client (Arbitrum)
 *
 * Handles the x402 v2 payment flow using `@x402/fetch`: it wraps `fetch` with
 * a viem signer so that a 402 response is automatically paid (USDC via
 * EIP-3009) and the request retried.
 */

import { wrapFetchWithPayment, decodePaymentResponseHeader, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { findTokenByAddress } from "@chainpe/sdk";
import { X402_NETWORK, DEFAULT_AGENT_NETWORK } from "./types.js";

import type {
  PaymentReceipt,
  PaymentToken,
  HttpRequestOptions,
  HttpResponse,
  ServiceInfo,
  ChainPeNetwork,
} from "./types.js";
import { addressFromPrivateKey, createWalletFromPrivateKey, parseAmount } from "./wallet.js";

export interface PaymentClientOptions {
  privateKey: string;
  network?: ChainPeNetwork;
  onPayment?: (receipt: PaymentReceipt) => void;
  /** Max USDC per payment (human string). Defaults to "10". */
  maxPerPayment?: string;
}

export class PaymentClient {
  private readonly privateKey: string;
  private readonly network: ChainPeNetwork;
  private readonly onPayment?: (receipt: PaymentReceipt) => void;
  private readonly maxValueAtomic: bigint;
  private readonly address: string;

  private wrappedFetch?: typeof fetch;
  private receipts: PaymentReceipt[] = [];
  private totalSpent: Record<PaymentToken, bigint> = { USDC: 0n };

  constructor(options: PaymentClientOptions) {
    this.privateKey = options.privateKey;
    this.network = options.network || DEFAULT_AGENT_NETWORK;
    this.onPayment = options.onPayment;
    this.maxValueAtomic = parseMaxPerPayment(options.maxPerPayment ?? "10");
    this.address = addressFromPrivateKey(options.privateKey);
  }

  /** Lazily builds the x402-wrapped fetch. */
  private async ensureReady(): Promise<typeof fetch> {
    if (!this.wrappedFetch) {
      const wallet = await createWalletFromPrivateKey(this.privateKey, this.network);
      const maxAtomic = this.maxValueAtomic;
      const network = this.network;
      // Only pay on this wallet's network, and never more than maxPerPayment
      // (replaces x402's default $1 cap).
      const client = new x402Client()
        .register(X402_NETWORK[this.network], new ExactEvmScheme(wallet.signer))
        .setSpendControls(false)
        // Only known stablecoins (USDC / USDT0), never above maxPerPayment.
        .registerPolicy((_version, reqs) =>
          reqs.filter((r) => findTokenByAddress(network, r.asset) && BigInt(r.amount) <= maxAtomic)
        );
      this.wrappedFetch = wrapFetchWithPayment(fetch, client);
    }
    return this.wrappedFetch;
  }

  getAddress(): string {
    return this.address;
  }

  /** Makes an HTTP request with automatic x402 payment handling. */
  async fetch<T = unknown>(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    const response = await this.request<T>(url, options);
    this.notifyPayment(response.paymentReceipt);
    return response;
  }

  private async request<T>(url: string, options: HttpRequestOptions): Promise<HttpResponse<T>> {
    const { method = "GET", headers = {}, body, timeout = 30000 } = options;
    const wrapped = await this.ensureReady();

    const fetchOptions: RequestInit = {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      signal: AbortSignal.timeout(timeout),
    };
    if (body && method !== "GET") fetchOptions.body = JSON.stringify(body);

    const response = await wrapped(url, fetchOptions);

    // The server sets PAYMENT-RESPONSE when a payment was made & settled.
    const settleHeader = response.headers.get("PAYMENT-RESPONSE");
    const paid = !!settleHeader;
    let receipt: PaymentReceipt | undefined;
    if (paid) {
      receipt = this.recordPayment(url, settleHeader);
    }

    const data = await this.parseResponse<T>(response);
    return {
      status: response.status,
      statusText: response.statusText,
      headers: this.headersToObject(response.headers),
      data,
      paid,
      paymentReceipt: receipt,
    };
  }

  /** Makes a request to a known paid service. */
  async callService<T = unknown>(
    service: ServiceInfo,
    path: string = "/",
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse<T>> {
    // "/" means the service's own endpoint (a Bazaar endpoint is the exact paid URL).
    const url = !path || path === "/" ? service.endpoint : new URL(path, service.endpoint).toString();
    const response = await this.request<T>(url, options);
    // Enrich the receipt with the service's metadata when available.
    if (response.paymentReceipt) {
      response.paymentReceipt.service = service.name;
      response.paymentReceipt.recipient = service.walletAddress || response.paymentReceipt.recipient;
      if (!response.paymentReceipt.amount || response.paymentReceipt.amount === "0") {
        response.paymentReceipt.amount = service.pricePerRequest;
      }
    }
    this.notifyPayment(response.paymentReceipt);
    return response;
  }

  /** Reports a settled payment to the `onPayment` callback; a throwing callback is ignored. */
  private notifyPayment(receipt: PaymentReceipt | undefined): void {
    if (!receipt || !this.onPayment) return;
    try {
      this.onPayment(receipt);
    } catch {
      /* the caller's callback must not break the paid call */
    }
  }

  private recordPayment(url: string, settleHeader: string): PaymentReceipt {
    let amount = "0";
    let recipient = "unknown";
    let txId: string | undefined;
    try {
      const decoded = decodePaymentResponseHeader(settleHeader);
      txId = decoded.transaction || undefined;
      if (decoded.amount) amount = formatAtomic(BigInt(decoded.amount));
    } catch {
      /* header not decodable — keep defaults */
    }

    const receipt: PaymentReceipt = {
      txId,
      amount,
      token: "USDC",
      recipient,
      timestamp: new Date(),
      service: "Unknown Service",
      path: safePath(url),
    };

    this.receipts.push(receipt);
    return receipt;
  }

  getReceipts(): PaymentReceipt[] {
    return [...this.receipts];
  }

  getTotalSpent(): Record<PaymentToken, string> {
    // Sum from receipt amounts (human strings) for an accurate total.
    let sum = 0n;
    for (const r of this.receipts) {
      try {
        sum += parseAmount(r.amount || "0");
      } catch {
        /* ignore */
      }
    }
    this.totalSpent.USDC = sum;
    return { USDC: formatAtomic(sum) };
  }

  getTransactionCount(): number {
    return this.receipts.length;
  }

  reset(): void {
    this.receipts = [];
    this.totalSpent = { USDC: 0n };
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }

  private headersToObject(headers: Headers): Record<string, string> {
    const obj: Record<string, string> = {};
    headers.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }
}

/** Parses a USDC limit such as "0.10"; rejects anything that isn't a positive decimal. */
function parseMaxPerPayment(value: string): bigint {
  const trimmed = String(value).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed) || parseAmount(trimmed) <= 0n) {
    throw new Error(
      `Invalid max price per payment "${value}": use a positive USDC amount with at most 6 decimals, e.g. "0.10".`
    );
  }
  return parseAmount(trimmed);
}

function formatAtomic(atomic: bigint): string {
  const divisor = 1_000_000n;
  const whole = atomic / divisor;
  const frac = atomic % divisor;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Creates a payment client. */
export function createPaymentClient(
  privateKey: string,
  options: Partial<PaymentClientOptions> = {}
): PaymentClient {
  return new PaymentClient({ privateKey, ...options });
}
