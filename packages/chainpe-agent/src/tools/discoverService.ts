/**
 * Discover Service Tool
 * AI tool for searching the ChainPe registry, Coinbase's x402 Bazaar and
 * ERC-8004 registration files (via the SDK).
 */

import { tool } from "ai";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

import type { ServiceDiscovery } from "../discovery.js";
import type { ServiceInfo, Registry } from "../types.js";

export interface DiscoverServiceToolOptions {
  discovery: ServiceDiscovery;
}

/**
 * Load local registry from ~/.chainpe/registry.json (fallback when discovery fails)
 */
async function loadLocalRegistry(): Promise<ServiceInfo[]> {
  try {
    const registryPath = path.join(os.homedir(), ".chainpe", "registry.json");
    const content = await fs.readFile(registryPath, "utf-8");
    const registry: Registry = JSON.parse(content);
    return registry.services || [];
  } catch {
    return [];
  }
}

/**
 * Filters the local fallback registry: a service matches when ANY query word
 * or ANY tag appears in it.
 */
function filterLocal(
  services: ServiceInfo[],
  options: { query?: string; tags?: string[]; maxPrice?: string }
): ServiceInfo[] {
  let results = [...services];
  if (options.query || options.tags?.length) {
    const queryWords = options.query
      ? options.query.toLowerCase().split(/\s+/).filter((w) => w.length > 1)
      : [];
    const searchTags = options.tags ? options.tags.map((t) => t.toLowerCase()) : [];
    results = results.filter((s) => {
      const searchText = `${s.name} ${s.description} ${s.tags.join(" ")}`.toLowerCase();
      const queryMatch = queryWords.length === 0 || queryWords.some((word) => searchText.includes(word));
      const tagMatch =
        searchTags.length === 0 ||
        s.tags.some((t) => searchTags.some((st) => t.toLowerCase().includes(st) || st.includes(t.toLowerCase())));
      return queryMatch || tagMatch;
    });
  }
  if (options.maxPrice) {
    const max = parseFloat(options.maxPrice);
    results = results.filter((s) => parseFloat(s.pricePerRequest) <= max);
  }
  return results;
}

/**
 * Creates a tool for discovering services
 */
export function createDiscoverServiceTool(options: DiscoverServiceToolOptions) {
  const { discovery } = options;

  return tool({
    description:
      "Search for paid services on Arbitrum: the ChainPe registry and Coinbase's x402 Bazaar. Use this to find services that can help with a task. Returns service names, descriptions, prices, reputation, and endpoints.",
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe("Search query to match against service names and descriptions"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter by tags (e.g., ['ai', 'research', 'nlp'])"),
      maxPrice: z
        .string()
        .optional()
        .describe("Maximum price per request (e.g., '0.1')"),
      paymentToken: z
        .enum(["USDC", "USDT0"])
        .optional()
        .describe("Filter by payment token"),
    }),
    execute: async ({ query, tags, maxPrice, paymentToken }) => {
      let services: Array<ServiceInfo & { reputation?: { score: number | null; count: number; verified: boolean } | null }>;
      let fallbackNote = "";
      try {
        services = await discovery.search({ query, tags, maxPrice });
      } catch (error) {
        services = filterLocal(await loadLocalRegistry(), { query, tags, maxPrice });
        fallbackNote = ` (discovery failed: ${(error as Error).message}; showing ~/.chainpe/registry.json)`;
      }
      if (paymentToken) services = services.filter((s) => s.paymentToken === paymentToken);

      if (services.length === 0) {
        return {
          found: false,
          message: `No services found matching your criteria${fallbackNote}.`,
          services: [],
        };
      }

      return {
        found: true,
        message: `Found ${services.length} service(s)${fallbackNote}`,
        services: services.map((s) => {
          const rep = s.reputation;
          return {
            name: s.name,
            description: s.description,
            price: `${s.pricePerRequest} ${s.paymentToken}`,
            tags: s.tags,
            endpoint: s.endpoint,
            source: s.source,
            agentId: s.agentId,
            reputation:
              rep && rep.count > 0 && rep.score !== null
                ? { score: rep.score, reviews: rep.count, paymentVerified: rep.verified }
                : s.agentId
                  ? "no ratings yet"
                  : "not registered for reputation",
          };
        }),
      };
    },
  });
}

/**
 * Format service info for display
 */
export function formatServiceForDisplay(service: ServiceInfo): string {
  return `**${service.name}**
  ${service.description}
  Price: ${service.pricePerRequest} ${service.paymentToken}
  Tags: ${service.tags.join(", ")}`;
}
