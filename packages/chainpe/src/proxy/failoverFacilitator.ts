/**
 * Failover facilitator client.
 *
 * Wraps an ordered list of facilitators. `verify` / `settle` go to the first
 * facilitator that supports the payment's network + scheme; if it is
 * unreachable (network error, timeout, malformed response) the next one is
 * tried. A structured rejection (`VerifyError` / `SettleError`, i.e. the
 * facilitator answered "invalid" / "failed") is a real answer and is returned
 * without trying the others.
 *
 * Retrying `settle` on another facilitator is safe: the payer's EIP-3009
 * authorization carries a unique nonce, so if the first facilitator did settle
 * before failing, the retry reverts with "authorization used" — the payer can
 * never be charged twice.
 */
import type { FacilitatorClient } from "@x402/core/server";
import {
  VerifyError,
  SettleError,
  type PaymentPayload,
  type PaymentRequirements,
  type SupportedResponse,
  type VerifyResponse,
  type SettleResponse,
} from "@x402/core/types";
import { logger } from "../logger.js";

export interface NamedFacilitator {
  /** Human-readable label for logs, e.g. "CDP". */
  name: string;
  client: FacilitatorClient;
}

/** True when the error means "this facilitator is unavailable", not "payment rejected". */
export function isRetryableFacilitatorError(err: unknown): boolean {
  return !(err instanceof VerifyError || err instanceof SettleError);
}

const kindKey = (network: string, scheme: string) => `${network}|${scheme}`;

export class FailoverFacilitatorClient implements FacilitatorClient {
  /** Per facilitator: the network|scheme pairs it reported, or undefined if unknown. */
  private readonly supported: Array<Set<string> | undefined>;

  constructor(private readonly facilitators: NamedFacilitator[]) {
    if (facilitators.length === 0) {
      throw new Error("FailoverFacilitatorClient needs at least one facilitator.");
    }
    this.supported = facilitators.map(() => undefined);
  }

  get names(): string[] {
    return this.facilitators.map((f) => f.name);
  }

  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    return this.first("verify", requirements, (c) => c.verify(payload, requirements));
  }

  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    return this.first("settle", requirements, (c) => c.settle(payload, requirements));
  }

  /** Merges `/supported` from every reachable facilitator and remembers who supports what. */
  async getSupported(): Promise<SupportedResponse> {
    const results = await Promise.allSettled(this.facilitators.map((f) => f.client.getSupported()));

    const kinds: SupportedResponse["kinds"] = [];
    const seen = new Set<string>();
    const extensions = new Set<string>();
    const signers: SupportedResponse["signers"] = {};

    results.forEach((r, i) => {
      if (r.status !== "fulfilled") {
        logger.warn(
          `Facilitator ${this.facilitators[i].name} /supported failed: ${(r.reason as Error)?.message ?? r.reason}`
        );
        return;
      }
      const mine = new Set<string>();
      for (const k of r.value.kinds) {
        mine.add(kindKey(k.network, k.scheme));
        const dedupe = `${k.x402Version}|${kindKey(k.network, k.scheme)}`;
        if (!seen.has(dedupe)) {
          seen.add(dedupe);
          kinds.push(k);
        }
      }
      this.supported[i] = mine;
      for (const e of r.value.extensions ?? []) extensions.add(e);
      for (const [family, addrs] of Object.entries(r.value.signers ?? {})) {
        signers[family] = [...new Set([...(signers[family] ?? []), ...addrs])];
      }
    });

    if (results.every((r) => r.status === "rejected")) {
      throw (results[0] as PromiseRejectedResult).reason;
    }
    return { kinds, extensions: [...extensions], signers };
  }

  private candidates(requirements: PaymentRequirements): NamedFacilitator[] {
    const key = kindKey(requirements.network, requirements.scheme);
    // Unknown support (never answered /supported) → still a candidate, tried last.
    const known = this.facilitators.filter((_, i) => this.supported[i]?.has(key));
    const unknown = this.facilitators.filter((_, i) => this.supported[i] === undefined);
    return [...known, ...unknown];
  }

  private async first<T>(
    op: "verify" | "settle",
    requirements: PaymentRequirements,
    call: (client: FacilitatorClient) => Promise<T>
  ): Promise<T> {
    const candidates = this.candidates(requirements);
    if (candidates.length === 0) {
      throw new Error(
        `No configured facilitator supports ${requirements.scheme} on ${requirements.network} ` +
          `(tried: ${this.names.join(", ")}).`
      );
    }

    let lastError: unknown;
    for (const [i, f] of candidates.entries()) {
      try {
        const result = await call(f.client);
        if (i > 0) logger.warn(`${op} succeeded on fallback facilitator ${f.name}`);
        return result;
      } catch (err) {
        if (!isRetryableFacilitatorError(err)) throw err;
        lastError = err;
        const next = candidates[i + 1];
        logger.warn(
          `Facilitator ${f.name} ${op} failed (${(err as Error)?.message ?? err})` +
            (next ? ` — trying ${next.name}` : "")
        );
      }
    }
    throw lastError;
  }
}
