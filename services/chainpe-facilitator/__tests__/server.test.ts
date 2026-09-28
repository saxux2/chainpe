import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";

// Module reads these at import time — set before the dynamic import below.
process.env.NODE_ENV = "test";
process.env.NETWORKS = "arbitrum-sepolia,arbitrum";
// Public Hardhat test key (not a real secret) — only to derive the address.
process.env.FACILITATOR_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

let server: Server;
let base: string;
let parseNetworks: (raw: string | undefined) => string[];

beforeAll(async () => {
  const mod = await import("../src/server.ts");
  parseNetworks = mod.parseNetworks;
  await new Promise<void>((resolve) => {
    server = mod.createApp().listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
});

describe("facilitator HTTP contract", () => {
  it("GET /health is a cheap liveness check", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.custodial).toBe(false);
    expect(body.facilitator.toLowerCase()).toBe(ADDR.toLowerCase());
    expect(body.x402Networks).toEqual(["eip155:421614", "eip155:42161"]);
  });

  it("GET /supported advertises x402 v2 exact on both Arbitrum networks", async () => {
    const res = await fetch(`${base}/supported`);
    const body = await res.json();
    expect(body.kinds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x402Version: 2, scheme: "exact", network: "eip155:421614" }),
        expect.objectContaining({ x402Version: 2, scheme: "exact", network: "eip155:42161" }),
      ])
    );
  });

  it("GET / lists the endpoints", async () => {
    const res = await fetch(`${base}/`);
    const body = await res.json();
    expect(body.service).toBe("chainpe-facilitator");
    expect(body.endpoints).toContain("/settle");
  });

  it("POST /verify rejects a malformed payload with a 400", async () => {
    const res = await fetch(`${base}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentPayload: {}, paymentRequirements: {} }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.isValid).toBe(false);
    expect(String(body.invalidReason)).toContain("verify_failed");
  });
});

describe("parseNetworks", () => {
  it("defaults to Arbitrum Sepolia", () => {
    expect(parseNetworks(undefined)).toEqual(["arbitrum-sepolia"]);
  });

  it("rejects unknown networks instead of silently switching chains", () => {
    expect(() => parseNetworks("avalanche")).toThrow(/Unsupported network "avalanche"/);
  });
});
