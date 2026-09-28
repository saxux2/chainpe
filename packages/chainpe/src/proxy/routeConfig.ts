/**
 * Route Configuration
 *
 * Builds the x402 v2 RoutesConfig from a ChainPeConfig. On EVM, x402 prices
 * are expressed as a USD/USDC string (e.g. "$0.01") and x402 maps that to the
 * network's default asset (Circle USDC). A catch-all "/*" gates every proxied
 * path, and additional per-path overrides may be supplied.
 */
import type { RoutesConfig, RouteConfig as X402RouteConfig } from "@x402/core/http";
import type { Price } from "@x402/core/types";
import { parseUnits } from "viem";
import { getToken } from "@chainpe/sdk";
import { getNetwork } from "../chains.js";
import type { ChainPeConfig, RouteConfig as ChainPeRouteConfig } from "../types.js";
import { createDiscoveryExtension } from "./discovery.js";

/** Converts a human USDC price ("0.01") to the x402 Money string ("$0.01"). */
function toMoney(price: string): string {
  const clean = price.trim().replace(/^\$/, "");
  return `$${clean}`;
}

export type { RoutesConfig };

export interface RoutesOptions {
  /**
   * ERC-8004 agent id to advertise in each offer's `extra.agentId`, so
   * consumers can leave reputation feedback without scanning the registry.
   */
  agentId?: string;
}

/**
 * x402 price for a human amount. USDC uses the "$0.01" shorthand (x402 maps
 * it to the network's default USDC); other tokens are named explicitly with
 * their EIP-712 domain so payers sign against the right contract.
 */
export function toPrice(config: Pick<ChainPeConfig, "network" | "paymentToken">, price: string): Price {
  const symbol = config.paymentToken ?? "USDC";
  if (symbol === "USDC") return toMoney(price);
  const token = getToken(config.network, symbol);
  return {
    amount: parseUnits(price.trim().replace(/^\$/, ""), token.decimals).toString(),
    asset: token.address,
    extra: {
      name: token.eip712Name,
      version: token.eip712Version,
      ...(token.transferMethod === "permit2" ? { assetTransferMethod: "permit2" } : {}),
    },
  };
}

export function createRoutesConfig(
  config: ChainPeConfig,
  additionalRoutes?: ChainPeRouteConfig[],
  options: RoutesOptions = {}
): RoutesConfig {
  const x402Network = getNetwork(config.network).x402Network;
  const extra = options.agentId ? { agentId: options.agentId } : undefined;
  const extensions = createDiscoveryExtension(config);

  const build = (price: string, description?: string): X402RouteConfig => ({
    accepts: {
      scheme: "exact",
      price: toPrice(config, price),
      network: x402Network,
      payTo: config.walletAddress,
      ...(extra ? { extra } : {}),
    },
    description:
      description || config.serviceDescription || `Pay ${price} ${config.paymentToken ?? "USDC"} per request`,
    serviceName: config.serviceName,
    tags: config.tags,
    ...(extensions ? { extensions } : {}),
  });

  const routes: Record<string, X402RouteConfig> = {};

  // Specific routes first.
  if (additionalRoutes) {
    for (const r of additionalRoutes) {
      routes[r.path] = build(r.pricePerRequest || config.pricePerRequest, r.description);
    }
  }

  // Catch-all: "/*" → matches every path beginning with "/".
  routes["/*"] = build(config.pricePerRequest);

  return routes;
}

/** Human-readable summary of the configured routes for CLI display. */
export function formatRoutesForDisplay(
  routes: RoutesConfig
): Array<{ path: string; price: string; token: string }> {
  if (!routes || typeof routes !== "object" || "accepts" in routes) {
    return [];
  }
  return Object.entries(routes as Record<string, X402RouteConfig>).map(([path, cfg]) => {
    const accepts = Array.isArray(cfg.accepts) ? cfg.accepts[0] : cfg.accepts;
    const price = accepts?.price;
    if (typeof price === "string" || typeof price === "number") {
      return { path, price: String(price), token: "USDC" };
    }
    if (typeof price === "object" && price !== null && "amount" in price) {
      const extra = (price as { extra?: { name?: string } }).extra;
      return { path, price: `${(price as { amount: string }).amount} (atomic)`, token: extra?.name ?? "token" };
    }
    return { path, price: "dynamic", token: "USDC" };
  });
}
