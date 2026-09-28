import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import {
  isDiscoveryEnabled,
  createDiscoveryExtension,
  discoveryMetadataWarnings,
  describeBazaarListing,
  discoveryFromSchema,
} from "../src/proxy/discovery.js";
import { createRoutesConfig } from "../src/proxy/routeConfig.js";
import { createProxyServer } from "../src/proxy/server.js";
import { setLogLevel } from "../src/logger.js";
import type { ChainPeConfig } from "../src/types.js";

const BASE: ChainPeConfig = {
  serviceName: "Weather API",
  serviceDescription: "Current weather for any city",
  tags: ["weather", "data"],
  targetUrl: "http://127.0.0.1:1",
  pricePerRequest: "0.01",
  paymentToken: "USDC",
  walletAddress: "0x1111111111111111111111111111111111111111",
  proxyPort: 0,
  network: "arbitrum",
};

type Bazaar = {
  info: { input: Record<string, unknown>; output?: { example?: unknown } };
  schema: { properties: { input: { properties: Record<string, unknown> }; output?: unknown } };
};

describe("isDiscoveryEnabled", () => {
  it("defaults on for Arbitrum One and off for Arbitrum Sepolia", () => {
    expect(isDiscoveryEnabled({ network: "arbitrum" })).toBe(true);
    expect(isDiscoveryEnabled({ network: "arbitrum-sepolia" })).toBe(false);
  });

  it("follows an explicit setting", () => {
    expect(isDiscoveryEnabled({ network: "arbitrum", discovery: { enabled: false } })).toBe(false);
    expect(isDiscoveryEnabled({ network: "arbitrum-sepolia", discovery: { enabled: true } })).toBe(true);
  });
});

describe("createDiscoveryExtension", () => {
  it("returns nothing when disabled", () => {
    expect(createDiscoveryExtension({ network: "arbitrum-sepolia" })).toBeUndefined();
  });

  it("declares a query (GET) resource by default, without a fixed method", () => {
    const ext = createDiscoveryExtension({ network: "arbitrum" })!;
    const bazaar = ext.bazaar as Bazaar;
    expect(bazaar.info.input.type).toBe("http");
    expect(bazaar.info.input.method).toBeUndefined();
    expect(bazaar.info.input.bodyType).toBeUndefined();
  });

  it("declares a JSON body for POST with the input schema", () => {
    const ext = createDiscoveryExtension({
      network: "arbitrum",
      discovery: {
        enabled: true,
        method: "POST",
        inputSchema: { properties: { city: { type: "string" } }, required: ["city"] },
        inputExample: { city: "Paris" },
      },
    })!;
    const bazaar = ext.bazaar as Bazaar;
    expect(bazaar.info.input.bodyType).toBe("json");
    expect(bazaar.info.input.body).toEqual({ city: "Paris" });
    expect(bazaar.schema.properties.input.properties.body).toMatchObject({
      properties: { city: { type: "string" } },
    });
  });

  it("publishes the output schema together with the example", () => {
    const ext = createDiscoveryExtension({
      network: "arbitrum",
      discovery: {
        enabled: true,
        outputExample: { tempC: 21 },
        outputSchema: { properties: { tempC: { type: "number" } } },
      },
    })!;
    const bazaar = ext.bazaar as Bazaar;
    expect(bazaar.info.output?.example).toEqual({ tempC: 21 });
    expect(bazaar.schema.properties.output).toBeDefined();
  });
});

describe("createRoutesConfig with discovery", () => {
  it("adds the bazaar extension and the service description to every route", () => {
    const routes = createRoutesConfig(BASE, [{ path: "/forecast", pricePerRequest: "0.02", paymentToken: "USDC" }]);
    for (const route of Object.values(routes)) {
      expect(route.extensions?.bazaar).toBeDefined();
      expect(route.serviceName).toBe("Weather API");
      expect(route.tags).toEqual(["weather", "data"]);
    }
    expect((routes as Record<string, { description?: string }>)["/*"].description).toBe(
      "Current weather for any city"
    );
  });

  it("leaves routes without extensions when discovery is off", () => {
    const routes = createRoutesConfig({ ...BASE, network: "arbitrum-sepolia" });
    expect(Object.values(routes)[0].extensions).toBeUndefined();
  });
});

describe("discoveryMetadataWarnings", () => {
  it("is quiet for valid metadata", () => {
    expect(discoveryMetadataWarnings(BASE)).toEqual([]);
  });

  it("warns about a long name, extra tags and an output schema without an example", () => {
    const warnings = discoveryMetadataWarnings({
      serviceName: "A service name that is far too long for Bazaar",
      tags: ["a", "b", "c", "d", "e", "f"],
      discovery: { enabled: true, outputSchema: { type: "object" } },
    });
    expect(warnings).toHaveLength(3);
    expect(warnings[1]).toContain("5 of 6");
  });
});

describe("describeBazaarListing", () => {
  it("reads the status and reason", () => {
    expect(describeBazaarListing({ bazaar: { status: "accepted" } })).toBe("accepted");
    expect(describeBazaarListing({ bazaar: { status: "rejected", rejectedReason: "invalid_schema" } })).toBe(
      "rejected (invalid_schema)"
    );
  });

  it("returns undefined when the facilitator said nothing about bazaar", () => {
    expect(describeBazaarListing(undefined)).toBeUndefined();
    expect(describeBazaarListing({ other: { status: "ok" } })).toBeUndefined();
  });
});

describe("discoveryFromSchema", () => {
  it("reads explicit discovery fields", () => {
    expect(
      discoveryFromSchema({
        method: "post",
        inputSchema: { properties: { q: { type: "string" } } },
        outputExample: { ok: true },
      })
    ).toEqual({
      method: "POST",
      inputSchema: { properties: { q: { type: "string" } } },
      outputExample: { ok: true },
    });
  });

  it("takes the method from a route list when every paid route agrees", () => {
    expect(
      discoveryFromSchema({
        routes: [
          { method: "GET", path: "/price", paid: true },
          { method: "GET", path: "/defi", paid: true },
          { method: "GET", path: "/health", paid: false },
        ],
      })
    ).toEqual({ method: "GET" });
  });

  it("leaves the method unset when paid routes disagree", () => {
    expect(
      discoveryFromSchema({
        routes: [
          { method: "POST", path: "/swap", paid: true },
          { method: "GET", path: "/tokens", paid: true },
        ],
      })
    ).toEqual({});
  });

  it("ignores junk", () => {
    expect(discoveryFromSchema(null)).toEqual({});
    expect(discoveryFromSchema("nope")).toEqual({});
  });
});

describe("proxy 402 offer", () => {
  let facilitator: Server;
  let proxy: Server;
  let proxyUrl: string;

  const listen = (app: express.Express) =>
    new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
  const urlOf = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

  beforeAll(async () => {
    setLogLevel("quiet");
    const stub = express();
    stub.get("/supported", (_req, res) => {
      res.json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:42161" }], extensions: [], signers: {} });
    });
    facilitator = await listen(stub);
    proxy = await listen(createProxyServer({ config: { ...BASE, facilitatorUrl: urlOf(facilitator) } }));
    proxyUrl = urlOf(proxy);
  });

  afterAll(() => {
    proxy?.close();
    facilitator?.close();
  });

  it("declares the bazaar extension with the request's method", async () => {
    const res = await fetch(`${proxyUrl}/weather?city=Paris`);
    expect(res.status).toBe(402);
    const required = decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!);
    const bazaar = required.extensions?.bazaar as Bazaar;
    expect(bazaar).toBeDefined();
    expect(bazaar.info.input.method).toBe("GET");
    expect(required.resource.serviceName).toBe("Weather API");
    expect(required.resource.description).toBe("Current weather for any city");
  });
});
