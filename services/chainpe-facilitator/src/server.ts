/**
 * ChainPe x402 Facilitator — standalone, non-custodial settlement service.
 *
 * Implements the x402 v2 facilitator HTTP contract (`/verify`, `/settle`,
 * `/supported`) for USDC (EIP-3009) payments on Arbitrum One and Arbitrum
 * Sepolia. One deployment can serve several networks. Point a ChainPe
 * provider proxy at it with `CHAINPE_FACILITATOR_URL`.
 *
 * NON-CUSTODIAL: the facilitator key only pays gas and relays the payer's
 * already-signed `transferWithAuthorization`. It never holds user funds and
 * cannot move money the payer did not authorize.
 *
 * Env:
 *   FACILITATOR_PRIVATE_KEY  (required) gas-paying key that submits settlements
 *   NETWORKS                 comma-separated: "arbitrum", "arbitrum-sepolia"
 *                            (default: $NETWORK, else "arbitrum-sepolia")
 *   NETWORK                  single-network alias for NETWORKS
 *   ARBITRUM_RPC_URL         optional RPC override for Arbitrum One
 *   ARBITRUM_SEPOLIA_RPC_URL optional RPC override for Arbitrum Sepolia
 *   RPC_URL                  optional RPC override when serving a single network
 *   PORT                     HTTP port (Railway injects this)
 *   ALLOWED_ORIGINS          comma-separated list of allowed CORS origins
 *                            (default: deny all cross-origin browser requests)
 */
import "dotenv/config";
import express, { type Request, type Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pino from "pino";
import {
  createPublicClient,
  createWalletClient,
  http,
  publicActions,
  formatEther,
  type Chain,
  type PublicClient,
} from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { x402Facilitator } from "@x402/core/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

// ─── Networks ───────────────────────────────────────────────────────────────

type NetworkName = "arbitrum" | "arbitrum-sepolia";

interface NetworkDef {
  chain: Chain;
  caip2: `eip155:${number}`;
  defaultRpc: string;
  rpcEnv: string;
}

const NETWORK_DEFS: Record<NetworkName, NetworkDef> = {
  arbitrum: {
    chain: arbitrum,
    caip2: "eip155:42161",
    defaultRpc: "https://arb1.arbitrum.io/rpc",
    rpcEnv: "ARBITRUM_RPC_URL",
  },
  "arbitrum-sepolia": {
    chain: arbitrumSepolia,
    caip2: "eip155:421614",
    defaultRpc: "https://sepolia-rollup.arbitrum.io/rpc",
    rpcEnv: "ARBITRUM_SEPOLIA_RPC_URL",
  },
};

/** Parses NETWORKS / NETWORK. Unknown names are fatal — never silently switch chains. */
export function parseNetworks(raw: string | undefined): NetworkName[] {
  const names = (raw ?? "arbitrum-sepolia")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (names.length === 0) return ["arbitrum-sepolia"];
  for (const n of names) {
    if (!(n in NETWORK_DEFS)) {
      throw new Error(
        `Unsupported network "${n}". Expected one of: ${Object.keys(NETWORK_DEFS).join(", ")}.`
      );
    }
  }
  return [...new Set(names)] as NetworkName[];
}

let NETWORKS: NetworkName[];
try {
  NETWORKS = parseNetworks(process.env.NETWORKS ?? process.env.NETWORK);
} catch (err) {
  log.fatal((err as Error).message);
  process.exit(1);
}
const PORT = parseInt(process.env.PORT ?? "4500", 10);

const rawKey = process.env.FACILITATOR_PRIVATE_KEY;
if (!rawKey) {
  log.fatal("FACILITATOR_PRIVATE_KEY is required (gas-paying settlement key).");
  process.exit(1);
}
const account = privateKeyToAccount((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`);

function rpcFor(name: NetworkName): string {
  const def = NETWORK_DEFS[name];
  return (
    process.env[def.rpcEnv] ||
    (NETWORKS.length === 1 ? process.env.RPC_URL : undefined) ||
    def.defaultRpc
  );
}

const publicClients = {} as Record<NetworkName, PublicClient>;
const facilitator = new x402Facilitator();

for (const name of NETWORKS) {
  const def = NETWORK_DEFS[name];
  const transport = http(rpcFor(name));
  publicClients[name] = createPublicClient({ chain: def.chain, transport }) as PublicClient;
  const client = createWalletClient({ account, chain: def.chain, transport }).extend(publicActions);
  const signer = toFacilitatorEvmSigner({
    address: account.address,
    readContract: (args) => client.readContract(args as Parameters<typeof client.readContract>[0]),
    verifyTypedData: (args) =>
      client.verifyTypedData(args as Parameters<typeof client.verifyTypedData>[0]),
    writeContract: (args) =>
      client.writeContract(args as Parameters<typeof client.writeContract>[0]),
    sendTransaction: (args) => client.sendTransaction(args),
    waitForTransactionReceipt: (args) => client.waitForTransactionReceipt(args),
    getCode: (args) => client.getCode(args),
  });
  facilitator.register(def.caip2, new ExactEvmScheme(signer));
}

// ─── Rate limiter: 60 requests / minute per IP ──────────────────────────────

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limit_exceeded" },
});

// ─── CORS config ────────────────────────────────────────────────────────────

function buildCorsOptions() {
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  const origins = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    // No origins configured → deny all browser cross-origin requests.
    // Server-to-server calls (no Origin header) still work fine.
    return cors({ origin: false });
  }
  return cors({ origin: origins, credentials: true });
}

// ─── In-memory Prometheus-style counters ────────────────────────────────────
// Intentionally simple: no external dep. Reset on process restart (acceptable
// for a single-instance Railway service — use Railway metrics for persistence).
const counters = {
  verify_success: 0,
  verify_error: 0,
  settle_success: 0,
  settle_error: 0,
};

// ─── Background gas-balance cache (refreshes every 60 s) ────────────────────
// Module-level so both /health and /metrics can read it without live RPC.
const cachedGasBalance = {} as Partial<Record<NetworkName, bigint>>;
// Arbitrum gas is cheap; 0.002 ETH covers hundreds of settlements.
const LOW_GAS_THRESHOLD = 2n * 10n ** 15n;

async function refreshGasBalances() {
  await Promise.all(
    NETWORKS.map(async (name) => {
      try {
        cachedGasBalance[name] = await publicClients[name].getBalance({ address: account.address });
      } catch {
        // Keep stale value on transient RPC errors; warn but don't crash.
      }
    })
  );
}

function lowGasNetworks(): NetworkName[] {
  return NETWORKS.filter((n) => {
    const b = cachedGasBalance[n];
    return b !== undefined && b < LOW_GAS_THRESHOLD;
  });
}

function x402Networks() {
  return NETWORKS.map((n) => NETWORK_DEFS[n].caip2);
}

export function createApp() {
  const app = express();
  app.use(buildCorsOptions());
  // Reduced from 1 MB — x402 payloads are well under 10 KB.
  app.use(express.json({ limit: "50kb" }));

  app.get("/", (_req: Request, res: Response) => {
    res.json({
      service: "chainpe-facilitator",
      description: "Non-custodial x402 verify + settle for USDC on Arbitrum.",
      networks: NETWORKS,
      custodial: false,
      endpoints: ["/health", "/status", "/supported", "/metrics", "/verify", "/settle"],
    });
  });

  // Liveness probe — always 200 while the process is running.
  // Gas warnings are in /status so Railway doesn't crash-loop on low balance.
  app.get("/health", (_req: Request, res: Response) => {
    const low = lowGasNetworks();
    if (low.length > 0) {
      log.warn(
        { facilitator: account.address, lowGasNetworks: low },
        "health check: ETH gas balance critically low — top up required"
      );
    }
    res.json({
      status: low.length > 0 ? "degraded" : "ok",
      service: "chainpe-facilitator",
      networks: NETWORKS,
      x402Networks: x402Networks(),
      facilitator: account.address,
      custodial: false,
      ...(low.length > 0 ? { warning: "low_gas", lowGasNetworks: low } : {}),
    });
  });

  // Operational status incl. the gas balances (reads the chain — use sparingly).
  app.get("/status", async (_req: Request, res: Response) => {
    const balances = await Promise.all(
      NETWORKS.map(async (name) => {
        const balance = await publicClients[name]
          .getBalance({ address: account.address })
          .catch(() => null);
        return {
          network: name,
          x402Network: NETWORK_DEFS[name].caip2,
          gasBalanceEth: balance != null ? formatEther(balance) : "unavailable",
          lowGas: balance != null ? balance < LOW_GAS_THRESHOLD : null,
        };
      })
    );
    res.json({
      service: "chainpe-facilitator",
      facilitator: account.address,
      networks: balances,
    });
  });

  app.get("/supported", (_req: Request, res: Response) => {
    res.json(facilitator.getSupported());
  });

  // Prometheus text-format metrics — scrape with Railway metrics or an external
  // Prometheus instance. Counters reset on restart; use Railway's built-in
  // service metrics for long-term trends.
  app.get("/metrics", (_req: Request, res: Response) => {
    const lines = [
      "# HELP chainpe_verify_total Total /verify requests handled",
      "# TYPE chainpe_verify_total counter",
      `chainpe_verify_total{result="success"} ${counters.verify_success}`,
      `chainpe_verify_total{result="error"} ${counters.verify_error}`,
      "# HELP chainpe_settle_total Total /settle requests handled",
      "# TYPE chainpe_settle_total counter",
      `chainpe_settle_total{result="success"} ${counters.settle_success}`,
      `chainpe_settle_total{result="error"} ${counters.settle_error}`,
      "# HELP chainpe_gas_balance_eth Current gas key ETH balance per network",
      "# TYPE chainpe_gas_balance_eth gauge",
      ...NETWORKS.map((name) => {
        const b = cachedGasBalance[name];
        const eth = b !== undefined ? Number(formatEther(b)) : 0;
        return `chainpe_gas_balance_eth{network="${name}",facilitator="${account.address}"} ${eth}`;
      }),
    ].join("\n") + "\n";
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(lines);
  });

  app.post("/verify", apiLimiter, async (req: Request, res: Response) => {
    try {
      const payload = req.body?.paymentPayload as PaymentPayload;
      const requirements = req.body?.paymentRequirements as PaymentRequirements;
      if (!payload?.accepted || !requirements?.network) {
        throw new Error("malformed paymentPayload / paymentRequirements");
      }
      const result = await facilitator.verify(payload, requirements);
      counters.verify_success++;
      log.info({ event: "verify", isValid: result.isValid, network: requirements.network }, "verify");
      res.json(result);
    } catch (err) {
      counters.verify_error++;
      log.error({ event: "verify_error", err }, "verify failed");
      res.status(400).json({ isValid: false, invalidReason: "verify_failed" });
    }
  });

  app.post("/settle", apiLimiter, async (req: Request, res: Response) => {
    const requirements = req.body?.paymentRequirements as PaymentRequirements | undefined;
    try {
      const payload = req.body?.paymentPayload as PaymentPayload;
      if (!payload?.accepted || !requirements?.network) {
        throw new Error("malformed paymentPayload / paymentRequirements");
      }
      const result = await facilitator.settle(payload, requirements);
      counters.settle_success++;
      log.info(
        { event: "settle", success: result.success, network: result.network, transaction: result.transaction },
        "settle"
      );
      res.json(result);
    } catch (err) {
      counters.settle_error++;
      log.error({ event: "settle_error", err }, "settle failed");
      res.status(400).json({
        success: false,
        errorReason: "settle_failed",
        transaction: "",
        network: requirements?.network ?? "",
      });
    }
  });

  return app;
}

async function main() {
  await refreshGasBalances();
  setInterval(() => { void refreshGasBalances(); }, 60_000);
  createApp().listen(PORT, () => {
    log.info(
      {
        networks: NETWORKS,
        x402Networks: x402Networks(),
        facilitator: account.address,
        gasBalanceEth: Object.fromEntries(
          NETWORKS.map((n) => [n, cachedGasBalance[n] !== undefined ? formatEther(cachedGasBalance[n]!) : "unavailable"])
        ),
      },
      `ChainPe facilitator listening on :${PORT}`
    );
    const low = lowGasNetworks();
    if (low.length > 0) {
      log.warn({ lowGasNetworks: low }, "Low ETH balance — top up the facilitator so it can pay settlement gas.");
    }
  });
}

// Only auto-start when run directly (not when imported by tests).
if (process.env.NODE_ENV !== "test") {
  main().catch((e) => {
    log.fatal(e, "fatal startup error");
    process.exit(1);
  });
}
