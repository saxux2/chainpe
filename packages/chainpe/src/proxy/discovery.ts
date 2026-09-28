/**
 * x402 Bazaar discovery for the provider proxy.
 *
 * When enabled, every route declares the `bazaar` extension. CDP lists the
 * resource after its first successful paid settlement through CDP, and reports
 * whether the listing was accepted in the settle response (EXTENSION-RESPONSES).
 */
import { declareDiscoveryExtension, isValidServiceName, sanitizeTags } from "@x402/extensions/bazaar";
import type { ChainPeConfig, DiscoveryConfig } from "../types.js";

/** Bazaar discovery is on by default only on Arbitrum One (CDP doesn't list testnets). */
export function isDiscoveryEnabled(config: Pick<ChainPeConfig, "network" | "discovery">): boolean {
  return config.discovery?.enabled ?? config.network === "arbitrum";
}

/**
 * The `bazaar` extension declared on every route. The HTTP method is left out:
 * `@x402/express` registers the Bazaar server extension, which fills it in from
 * each request.
 */
export function createDiscoveryExtension(
  config: Pick<ChainPeConfig, "network" | "discovery">
): Record<string, unknown> | undefined {
  if (!isDiscoveryEnabled(config)) return undefined;
  const d = config.discovery ?? { enabled: true };
  const output =
    d.outputExample !== undefined
      ? { example: d.outputExample, schema: d.outputSchema as Record<string, unknown> | undefined }
      : undefined;
  const input = d.inputExample;
  const inputSchema = d.inputSchema as Record<string, unknown> | undefined;
  return d.method === "POST"
    ? declareDiscoveryExtension({ bodyType: "json", input, inputSchema, output })
    : declareDiscoveryExtension({ input, inputSchema, output });
}

/**
 * Metadata the Bazaar will silently drop: `serviceName` must be printable ASCII
 * of at most 32 characters, and only the first 5 valid tags (each ≤ 32 ASCII
 * characters) are kept.
 */
export function discoveryMetadataWarnings(
  config: Pick<ChainPeConfig, "serviceName" | "tags" | "discovery">
): string[] {
  const warnings: string[] = [];
  if (!isValidServiceName(config.serviceName)) {
    warnings.push(`Service name "${config.serviceName}" is not 1–32 printable ASCII characters; Bazaar will omit it.`);
  }
  const kept = sanitizeTags(config.tags) ?? [];
  if (kept.length < config.tags.length) {
    warnings.push(`Bazaar keeps ${kept.length} of ${config.tags.length} tags: ${kept.join(", ") || "(none)"}.`);
  }
  const d = config.discovery;
  if (d?.outputSchema && d.outputExample === undefined) {
    warnings.push("discovery.outputSchema is only published together with discovery.outputExample.");
  }
  return warnings;
}

/**
 * Reads the facilitator's verdict on the Bazaar listing from a settle
 * response's `extensionResponses`. Returns undefined when the facilitator
 * said nothing about it.
 */
export function describeBazaarListing(extensionResponses: unknown): string | undefined {
  if (!extensionResponses || typeof extensionResponses !== "object") return undefined;
  const bazaar = (extensionResponses as Record<string, unknown>).bazaar;
  if (!bazaar || typeof bazaar !== "object") return undefined;
  const r = bazaar as Record<string, unknown>;
  const status = typeof r.status === "string" ? r.status : "unknown";
  const reason = [r.rejectedReason, r.reason, r.code].find((v) => typeof v === "string");
  return reason ? `${status} (${reason})` : status;
}

/**
 * Discovery fields from a backend's `/schema` response. Two shapes are read:
 *   - `{ method?, inputSchema?, outputSchema?, inputExample?, outputExample? }`
 *   - ChainPe's route list `{ routes: [{ method, path, paid }] }` — only the
 *     method is taken, and only when every paid route uses the same one.
 */
export function discoveryFromSchema(schema: unknown): Omit<DiscoveryConfig, "enabled"> {
  if (!schema || typeof schema !== "object") return {};
  const s = schema as Record<string, unknown>;
  const out: Omit<DiscoveryConfig, "enabled"> = {};

  const isObject = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const asMethod = (v: unknown): "GET" | "POST" | undefined => {
    const m = typeof v === "string" ? v.toUpperCase() : undefined;
    return m === "GET" || m === "POST" ? m : undefined;
  };

  if (isObject(s.inputSchema)) out.inputSchema = s.inputSchema;
  if (isObject(s.outputSchema)) out.outputSchema = s.outputSchema;
  if (isObject(s.inputExample)) out.inputExample = s.inputExample;
  if (s.outputExample !== undefined) out.outputExample = s.outputExample;

  let method = asMethod(s.method);
  if (!method && Array.isArray(s.routes)) {
    const paid = s.routes.filter((r): r is Record<string, unknown> => isObject(r) && r.paid !== false);
    const methods = new Set(paid.map((r) => asMethod(r.method)));
    if (methods.size === 1) method = [...methods][0];
  }
  if (method) out.method = method;
  return out;
}
