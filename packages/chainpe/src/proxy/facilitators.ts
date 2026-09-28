/**
 * Facilitator selection for the provider proxy.
 *
 * A provider lists facilitators in order of preference. Defaults:
 *   arbitrum          CDP (when CDP_API_KEY_ID / CDP_API_KEY_SECRET are set) → PayAI
 *   arbitrum-sepolia  PayAI (CDP has no Arbitrum Sepolia support)
 */
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import type { ChainPeConfig, FacilitatorSpec } from "../types.js";
import type { NamedFacilitator } from "./failoverFacilitator.js";
import { logger } from "../logger.js";

/** PayAI's public facilitator: free tier, supports Arbitrum One + Sepolia. */
export const DEFAULT_FACILITATOR_URL = "https://facilitator.payai.network";

export function hasCdpCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET);
}

/** Resolves the ordered facilitator list for a provider config. */
export function resolveFacilitatorSpecs(
  config: Pick<ChainPeConfig, "network" | "facilitators" | "facilitatorUrl">,
  env: NodeJS.ProcessEnv = process.env
): FacilitatorSpec[] {
  if (config.facilitators && config.facilitators.length > 0) return config.facilitators;
  if (config.facilitatorUrl) return [{ kind: "url", url: config.facilitatorUrl }];
  if (config.network === "arbitrum") {
    if (hasCdpCredentials(env)) return [{ kind: "cdp" }, { kind: "payai" }];
    logger.info("CDP_API_KEY_ID / CDP_API_KEY_SECRET not set — using PayAI only.");
  }
  return [{ kind: "payai" }];
}

/** Builds a facilitator client for one spec. */
export function buildFacilitator(
  spec: FacilitatorSpec,
  env: NodeJS.ProcessEnv = process.env
): NamedFacilitator {
  switch (spec.kind) {
    case "cdp": {
      const id = env.CDP_API_KEY_ID;
      const secret = env.CDP_API_KEY_SECRET;
      if (!id || !secret) {
        throw new Error("The CDP facilitator needs CDP_API_KEY_ID and CDP_API_KEY_SECRET.");
      }
      return { name: "CDP", client: new HTTPFacilitatorClient(createFacilitatorConfig(id, secret)) };
    }
    case "payai":
      return { name: "PayAI", client: new HTTPFacilitatorClient({ url: DEFAULT_FACILITATOR_URL }) };
    case "url":
      return { name: spec.url, client: new HTTPFacilitatorClient({ url: spec.url }) };
  }
}
