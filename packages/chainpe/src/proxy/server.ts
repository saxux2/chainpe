/**
 * ChainPe Proxy Server (Arbitrum)
 *
 * x402 v2 payment gateway built on `@x402/express`. Every proxied request is
 * gated by a USDC payment (EIP-3009) on Arbitrum; once paid and settled by a
 * facilitator, the request is forwarded to the provider's backend.
 *
 * Facilitator modes:
 *   1. External (default): an ordered list with failover — CDP → PayAI on
 *      Arbitrum One (CDP only with API keys), PayAI on Arbitrum Sepolia, or
 *      `facilitators` / `facilitatorUrl` from config. The provider needs no
 *      wallet key — it only receives payments.
 *   2. Local (`--facilitator <privateKey>`): settles in-process using a funded
 *      gas wallet. No external dependency.
 */

import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { createProxyMiddleware, type Options as ProxyOptions } from "http-proxy-middleware";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import type { FacilitatorClient } from "@x402/core/server";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";

import type { ChainPeConfig, PaymentEvent, RouteConfig } from "../types.js";
import { createRoutesConfig, formatRoutesForDisplay } from "./routeConfig.js";
import { isDiscoveryEnabled, discoveryMetadataWarnings, describeBazaarListing } from "./discovery.js";
import { createLocalFacilitator, toFacilitatorClient } from "./localFacilitator.js";
import { resolveFacilitatorSpecs, buildFacilitator } from "./facilitators.js";
import { FailoverFacilitatorClient } from "./failoverFacilitator.js";
import { getNetwork } from "../chains.js";
import { analytics } from "./analytics.js";
import { logger, logPayment, logRequest, logServerStart } from "../logger.js";

export interface ProxyServerOptions {
  config: ChainPeConfig;
  additionalRoutes?: RouteConfig[];
  onPayment?: (event: PaymentEvent) => void;
  /** Optional EVM private key to run an in-process facilitator (settles on-chain). */
  facilitatorKey?: string;
}

export { DEFAULT_FACILITATOR_URL } from "./facilitators.js";

export function createProxyServer(options: ProxyServerOptions): Express {
  const { config, additionalRoutes, onPayment, facilitatorKey } = options;
  const app = express();

  app.use(
    cors({ exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-CHAINPE-AGENT-ID"] })
  );

  // Request logging / counting (raw — no body parsing, so proxying is unaffected).
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    analytics.recordRequest();
    res.on("finish", () => logRequest(req.method, req.path, res.statusCode, Date.now() - start));
    next();
  });

  // Health check (not gated).
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: config.serviceName, uptime: process.uptime() });
  });

  // Admin endpoints (JSON-parsed, optionally key-protected) — not gated.
  const adminRouter = express.Router();
  adminRouter.use(express.json());
  if (config.adminKey) {
    adminRouter.use((req: Request, res: Response, next: NextFunction) => {
      const apiKey = req.headers["x-admin-key"] || req.query.adminKey;
      if (apiKey !== config.adminKey) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      next();
    });
  }
  adminRouter.get("/stats", (_req: Request, res: Response) => {
    res.json({ ...analytics.getStats(), revenue: analytics.getRevenueSummary(), totalRevenue: undefined, revenueByToken: undefined });
  });
  adminRouter.get("/payments", (_req: Request, res: Response) => res.json(analytics.getRecentPayments()));
  adminRouter.get("/config", (_req: Request, res: Response) => {
    res.json({
      serviceName: config.serviceName,
      serviceDescription: config.serviceDescription,
      targetUrl: config.targetUrl,
      pricePerRequest: config.pricePerRequest,
      paymentToken: config.paymentToken,
      walletAddress: config.walletAddress,
      network: config.network,
      tags: config.tags,
    });
  });
  // Pass-through: fetch /schema from the backend so agents can self-describe
  // their routes without going through the payment gate.
  adminRouter.get("/schema", async (_req: Request, res: Response) => {
    try {
      const r = await fetch(`${config.targetUrl}/schema`);
      if (!r.ok) { res.status(404).json({ error: "Agent has no /schema endpoint" }); return; }
      res.json(await r.json());
    } catch {
      res.status(503).json({ error: "Backend unreachable" });
    }
  });
  app.use("/chainpe-admin", adminRouter);

  // Resolve the facilitator. Local mode settles in-process with the gas key;
  // otherwise use the configured (or default) external facilitators with failover.
  const network = getNetwork(config.network);
  let facilitator: FacilitatorClient;
  if (facilitatorKey) {
    facilitator = toFacilitatorClient(createLocalFacilitator(facilitatorKey, config.network));
    logger.info("Using in-process facilitator (settles on-chain with the provided gas key)");
  } else {
    const failover = new FailoverFacilitatorClient(
      resolveFacilitatorSpecs(config).map((spec) => buildFacilitator(spec))
    );
    facilitator = failover;
    logger.info(`Using facilitators: ${failover.names.join(" → ")}`);
  }

  // 3b: advertise this provider's ERC-8004 agentId so consumers can leave
  // reputation feedback without scanning the whole registry by payTo. It is
  // carried in each offer's `extra.agentId` and an `X-CHAINPE-AGENT-ID` header.
  const advertisedAgentId = config.agentId ?? process.env.CHAINPE_AGENT_ID;
  const agentId = advertisedAgentId && advertisedAgentId !== "0" ? advertisedAgentId : undefined;
  if (agentId) {
    app.use((_req: Request, res: Response, next: NextFunction) => {
      res.setHeader("X-CHAINPE-AGENT-ID", agentId);
      next();
    });
  }

  // x402 routes.
  const routesConfig = createRoutesConfig(config, additionalRoutes, { agentId });
  logger.info("Configured x402 routes:");
  for (const r of formatRoutesForDisplay(routesConfig)) {
    logger.info(`  ${r.path} → ${r.price} ${r.token}`);
  }

  // Bazaar discovery: CDP lists the resource after its first paid settlement
  // through CDP and reports the verdict in the settle response.
  const discovery = isDiscoveryEnabled(config);
  if (discovery) {
    logger.info("Bazaar discovery: declared on every offer (listed after the first CDP settlement)");
    for (const w of discoveryMetadataWarnings(config)) logger.warn(w);
  }

  // Payment middleware (gates everything after it).
  const resourceServer = new x402ResourceServer(facilitator).register(
    network.x402Network,
    new ExactEvmScheme()
  );
  if (discovery) {
    resourceServer.onAfterSettle(async ({ result }) => {
      const listing = describeBazaarListing(result.extensionResponses);
      if (listing) logger.info(`Bazaar listing: ${listing}`);
    });
  }
  app.use(
    paymentMiddleware(routesConfig, resourceServer, {
      appName: config.serviceName,
      testnet: network.testnet,
    })
  );

  // Payment tracking — record successful settlements (x402 sets PAYMENT-RESPONSE).
  app.use((req: Request, res: Response, next: NextFunction) => {
    const originalEnd = res.end.bind(res);
    res.on("finish", () => {
      const header = res.getHeader("PAYMENT-RESPONSE");
      if (header && res.statusCode < 400) {
        let payer = "unknown";
        let txId: string | undefined;
        try {
          const decoded = decodePaymentResponseHeader(String(header));
          payer = decoded.payer ?? "unknown";
          txId = decoded.transaction || undefined;
        } catch {
          /* undecodable header — ignore */
        }
        const event: PaymentEvent = {
          timestamp: new Date(),
          path: req.path,
          amount: config.pricePerRequest,
          token: config.paymentToken,
          payer,
          txId,
          success: true,
        };
        analytics.recordPayment(event);
        logPayment(event.amount, event.token, payer, req.path);
        onPayment?.(event);
      }
    });
    void originalEnd;
    next();
  });

  // Reverse proxy to the provider backend.
  const proxyOptions: ProxyOptions = {
    target: config.targetUrl,
    changeOrigin: true,
    ws: true,
    on: {
      proxyReq: (_proxyReq, req) => logger.verbose(`Proxying ${req.method} ${req.url} → ${config.targetUrl}`),
      proxyRes: (proxyRes, req) => logger.verbose(`Response ${config.targetUrl}${req.url}: ${proxyRes.statusCode}`),
      error: (err, _req, res) => {
        logger.error(`Proxy error: ${err.message}`);
        if (res && "writeHead" in res && typeof (res as Response).status === "function") {
          (res as Response).status(502).json({ error: "Bad Gateway", message: "Failed to reach upstream server" });
        }
      },
    },
  };
  app.use("/", createProxyMiddleware(proxyOptions));

  return app;
}

export async function startProxyServer(
  options: ProxyServerOptions
): Promise<{ app: Express; server: ReturnType<Express["listen"]> }> {
  const { config } = options;
  const app = createProxyServer(options);
  return new Promise((resolve) => {
    const server = app.listen(config.proxyPort, () => {
      logServerStart(config.proxyPort, config.serviceName);
      resolve({ app, server });
    });
  });
}

export { analytics };
