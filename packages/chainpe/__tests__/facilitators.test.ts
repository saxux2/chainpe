import { describe, it, expect, vi } from "vitest";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { VerifyError, SettleError } from "@x402/core/types";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SupportedResponse } from "@x402/core/types";
import {
  resolveFacilitatorSpecs,
  buildFacilitator,
  DEFAULT_FACILITATOR_URL,
} from "../src/proxy/facilitators.js";
import {
  FailoverFacilitatorClient,
  isRetryableFacilitatorError,
} from "../src/proxy/failoverFacilitator.js";

const CDP_ENV = { CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "secret" } as NodeJS.ProcessEnv;
const NO_ENV = {} as NodeJS.ProcessEnv;

describe("resolveFacilitatorSpecs", () => {
  it("uses CDP then PayAI on Arbitrum One when CDP keys are set", () => {
    expect(resolveFacilitatorSpecs({ network: "arbitrum" }, CDP_ENV)).toEqual([
      { kind: "cdp" },
      { kind: "payai" },
    ]);
  });

  it("uses PayAI only on Arbitrum One without CDP keys", () => {
    expect(resolveFacilitatorSpecs({ network: "arbitrum" }, NO_ENV)).toEqual([{ kind: "payai" }]);
  });

  it("uses PayAI on Arbitrum Sepolia even with CDP keys (CDP has no Sepolia)", () => {
    expect(resolveFacilitatorSpecs({ network: "arbitrum-sepolia" }, CDP_ENV)).toEqual([
      { kind: "payai" },
    ]);
  });

  it("treats facilitatorUrl as a single custom facilitator", () => {
    expect(
      resolveFacilitatorSpecs({ network: "arbitrum", facilitatorUrl: "https://f.example" }, CDP_ENV)
    ).toEqual([{ kind: "url", url: "https://f.example" }]);
  });

  it("prefers an explicit facilitators list", () => {
    const facilitators = [{ kind: "url" as const, url: "https://mine.example" }, { kind: "payai" as const }];
    expect(resolveFacilitatorSpecs({ network: "arbitrum", facilitators }, CDP_ENV)).toBe(facilitators);
  });
});

describe("buildFacilitator", () => {
  it("builds an authenticated CDP client when keys are present", () => {
    const f = buildFacilitator({ kind: "cdp" }, CDP_ENV);
    expect(f.name).toBe("CDP");
    expect(f.client).toBeInstanceOf(HTTPFacilitatorClient);
    expect((f.client as HTTPFacilitatorClient).url).toBe("https://api.cdp.coinbase.com/platform/v2/x402");
  });

  it("refuses CDP without keys", () => {
    expect(() => buildFacilitator({ kind: "cdp" }, NO_ENV)).toThrow(/CDP_API_KEY_ID/);
  });

  it("points PayAI at its public facilitator", () => {
    const f = buildFacilitator({ kind: "payai" }, NO_ENV);
    expect((f.client as HTTPFacilitatorClient).url).toBe(DEFAULT_FACILITATOR_URL);
  });
});

// ─── Failover ────────────────────────────────────────────────────────────────

const SEPOLIA = "eip155:421614";
const MAINNET = "eip155:42161";
const payload = {} as PaymentPayload;
const req = (network: string) =>
  ({ scheme: "exact", network, asset: "0x", amount: "1", payTo: "0x", maxTimeoutSeconds: 60, extra: {} }) as PaymentRequirements;

function fakeClient(networks: string[], impl: Partial<FacilitatorClient> = {}): FacilitatorClient {
  const supported: SupportedResponse = {
    kinds: networks.map((network) => ({ x402Version: 2, scheme: "exact", network: network as `${string}:${string}` })),
    extensions: [],
    signers: {},
  };
  return {
    verify: vi.fn(async () => ({ isValid: true })),
    settle: vi.fn(async () => ({ success: true, transaction: "0xtx", network: networks[0] as `${string}:${string}` })),
    getSupported: vi.fn(async () => supported),
    ...impl,
  };
}

describe("FailoverFacilitatorClient", () => {
  it("moves to the next facilitator when the first times out", async () => {
    const down = fakeClient([MAINNET], { settle: vi.fn(async () => { throw new Error("timeout"); }) });
    const up = fakeClient([MAINNET]);
    const f = new FailoverFacilitatorClient([
      { name: "CDP", client: down },
      { name: "PayAI", client: up },
    ]);
    await f.getSupported();
    await expect(f.settle(payload, req(MAINNET))).resolves.toMatchObject({ success: true });
    expect(up.settle).toHaveBeenCalledOnce();
  });

  it("returns a real rejection without trying the next facilitator", async () => {
    const rejecting = fakeClient([MAINNET], {
      verify: vi.fn(async () => { throw new VerifyError(400, { isValid: false, invalidReason: "insufficient_funds" }); }),
    });
    const other = fakeClient([MAINNET]);
    const f = new FailoverFacilitatorClient([
      { name: "CDP", client: rejecting },
      { name: "PayAI", client: other },
    ]);
    await f.getSupported();
    await expect(f.verify(payload, req(MAINNET))).rejects.toBeInstanceOf(VerifyError);
    expect(other.verify).not.toHaveBeenCalled();
  });

  it("only routes to facilitators that support the network", async () => {
    const cdp = fakeClient([MAINNET]);
    const payai = fakeClient([MAINNET, SEPOLIA]);
    const f = new FailoverFacilitatorClient([
      { name: "CDP", client: cdp },
      { name: "PayAI", client: payai },
    ]);
    await f.getSupported();
    await f.verify(payload, req(SEPOLIA));
    expect(cdp.verify).not.toHaveBeenCalled();
    expect(payai.verify).toHaveBeenCalledOnce();
  });

  it("throws the last error when every facilitator is down", async () => {
    const a = fakeClient([MAINNET], { settle: vi.fn(async () => { throw new Error("a down"); }) });
    const b = fakeClient([MAINNET], { settle: vi.fn(async () => { throw new Error("b down"); }) });
    const f = new FailoverFacilitatorClient([
      { name: "A", client: a },
      { name: "B", client: b },
    ]);
    await f.getSupported();
    await expect(f.settle(payload, req(MAINNET))).rejects.toThrow("b down");
  });

  it("merges /supported and tolerates an unreachable facilitator", async () => {
    const down = fakeClient([], { getSupported: vi.fn(async () => { throw new Error("offline"); }) });
    const payai = fakeClient([MAINNET, SEPOLIA]);
    const f = new FailoverFacilitatorClient([
      { name: "CDP", client: down },
      { name: "PayAI", client: payai },
    ]);
    const supported = await f.getSupported();
    expect(supported.kinds.map((k) => k.network).sort()).toEqual([MAINNET, SEPOLIA].sort());
  });

  it("still tries a facilitator whose /supported was never read", async () => {
    const unknown = fakeClient([MAINNET]);
    const f = new FailoverFacilitatorClient([{ name: "X", client: unknown }]);
    await f.verify(payload, req(MAINNET));
    expect(unknown.verify).toHaveBeenCalledOnce();
  });
});

describe("isRetryableFacilitatorError", () => {
  it("treats structured rejections as final", () => {
    expect(isRetryableFacilitatorError(new VerifyError(400, { isValid: false }))).toBe(false);
    expect(isRetryableFacilitatorError(new SettleError(400, { success: false, transaction: "", network: MAINNET }))).toBe(false);
  });

  it("treats network errors and timeouts as retryable", () => {
    expect(isRetryableFacilitatorError(new Error("fetch failed"))).toBe(true);
  });
});
