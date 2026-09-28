/**
 * ChainPe E2E test — mainnet integration.
 *
 * Two-track strategy:
 *   Tracks 1–4  Local Hardhat network with fresh contracts + MockUSDC.
 *               Tests the identical contract code deployed on mainnet without
 *               needing real USDC.
 *   Track 5     Hosted facilitator endpoints (set FACILITATOR_URL).
 *   Track 6     Indexer API (set INDEXER_URL).
 *   Track 7     Direct Arbitrum One read — verifies the deployed
 *               ChainPeRegistry (set CHAINPE_REGISTRY_ADDRESS).
 *   Tracks 5–7 are skipped when their env var is unset.
 *
 * Run:
 *   cd contracts && npx hardhat test test/E2E.mainnet-fork.test.ts
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { ChainPeRegistry, MockUSDC } from "../typechain-types";

// ── Mainnet constants ────────────────────────────────────────────────────────

const MAINNET_REGISTRY = process.env.CHAINPE_REGISTRY_ADDRESS;
const MAINNET_RPC      = process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc";
const MAINNET_USDC     = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

const FACILITATOR_URL = process.env.FACILITATOR_URL;
const INDEXER_URL     = process.env.INDEXER_URL;

const REGISTRATION_FEE = ethers.parseUnits("1.0", 6); // 1 USDC
const PAYMENT_AMOUNT   = ethers.parseUnits("0.01", 6); // 0.01 USDC per call

// ── Local fixture — deploys fresh contracts identical to mainnet ─────────────

async function localFixture() {
  const [owner, provider, consumer, facilitatorSigner, treasury] = await ethers.getSigners();

  // Deploy MockUSDC (same role as Circle USDC on mainnet).
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = (await MockUSDC.deploy()) as unknown as MockUSDC;
  await usdc.waitForDeployment();

  // Deploy ChainPeRegistry — same bytecode as mainnet proxy impl.
  const Registry = await ethers.getContractFactory("ChainPeRegistry");
  const registry = (await Registry.deploy(
    await usdc.getAddress(),
    treasury.address,
    REGISTRATION_FEE,
    ethers.ZeroAddress,
    owner.address
  )) as unknown as ChainPeRegistry;
  await registry.waitForDeployment();

  // Fund provider with enough USDC to register + some buffer.
  await usdc.mint(provider.address, REGISTRATION_FEE + ethers.parseUnits("5", 6));
  await (usdc.connect(provider) as typeof usdc).approve(await registry.getAddress(), ethers.MaxUint256);

  // Fund consumer with USDC for payments.
  await usdc.mint(consumer.address, ethers.parseUnits("1", 6));

  return { owner, provider, consumer, facilitatorSigner, treasury, usdc, registry };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ChainPe E2E — Mainnet Integration", function () {
  this.timeout(60_000);

  // ── Track 1–4: local contract logic (MockUSDC, same bytecode as mainnet) ──

  it("Step 1 — USDC minted to provider and consumer", async () => {
    const { provider, consumer, usdc } = await loadFixture(localFixture);

    const providerBal = await usdc.balanceOf(provider.address);
    const consumerBal = await usdc.balanceOf(consumer.address);

    console.log(`  Provider MockUSDC: ${ethers.formatUnits(providerBal, 6)}`);
    console.log(`  Consumer MockUSDC: ${ethers.formatUnits(consumerBal, 6)}`);

    expect(providerBal).to.be.gte(REGISTRATION_FEE);
    expect(consumerBal).to.be.gt(0n);
  });

  it("Step 2 — Register service on local ChainPeRegistry (identical bytecode to mainnet)", async () => {
    const { provider, registry, usdc, treasury } = await loadFixture(localFixture);

    const treasuryBefore = await usdc.balanceOf(treasury.address);
    const countBefore    = await registry.getServiceCount();

    const tx = await (registry.connect(provider) as typeof registry).register({
      name: "E2E Test API",
      description: "Mainnet fork E2E test service",
      tags: "test,e2e",
      endpoint: "https://e2e-test.chainpe.app",
      pricePerRequest: "0.01",
      paymentToken: "USDC",
      network: "arbitrum",
      payTo: provider.address,
      agentId: 0n,
    });
    const receipt = await tx.wait();

    console.log(`  Register tx: ${receipt!.hash}`);
    console.log(`  Gas used: ${receipt!.gasUsed}`);

    const svc = await registry.getService(provider.address, "E2E Test API");
    expect(svc.exists).to.be.true;
    expect(svc.name).to.equal("E2E Test API");
    expect(svc.payTo).to.equal(provider.address);

    const countAfter    = await registry.getServiceCount();
    const treasuryAfter = await usdc.balanceOf(treasury.address);

    expect(countAfter).to.equal(countBefore + 1n);
    expect(treasuryAfter - treasuryBefore).to.equal(REGISTRATION_FEE, "fee collected");
    console.log(`  Service registered: PASS — fee ${ethers.formatUnits(REGISTRATION_FEE, 6)} USDC collected`);
  });

  it("Step 3 — EIP-3009 payment authorization signed by consumer", async () => {
    const { consumer, usdc, provider } = await loadFixture(localFixture);

    // On local Hardhat (chainId 31337) MockUSDC — build domain from contract.
    const usdcAddr = await usdc.getAddress();
    const chainId  = (await ethers.provider.getNetwork()).chainId;

    const domain = {
      name: "USD Coin",
      version: "2",
      chainId,
      verifyingContract: usdcAddr as `0x${string}`,
    };
    const types = {
      TransferWithAuthorization: [
        { name: "from",        type: "address" },
        { name: "to",          type: "address" },
        { name: "value",       type: "uint256" },
        { name: "validAfter",  type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce",       type: "bytes32" },
      ],
    };
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const message = {
      from:        consumer.address,
      to:          provider.address,
      value:       PAYMENT_AMOUNT,
      validAfter:  0n,
      validBefore: BigInt(Math.floor(Date.now() / 1000) + 3600),
      nonce,
    };

    const sig       = await consumer.signTypedData(domain, types, message);
    const recovered = ethers.verifyTypedData(domain, types, message, sig);

    console.log(`  Consumer: ${consumer.address}`);
    console.log(`  Amount: ${ethers.formatUnits(PAYMENT_AMOUNT, 6)} USDC`);
    console.log(`  Signature recovered: ${recovered}`);

    expect(recovered.toLowerCase()).to.equal(consumer.address.toLowerCase());
    console.log(`  EIP-712 signature verification: PASS`);
  });

  it("Step 4 — Facilitator settles transferWithAuthorization (USDC moves consumer → provider)", async () => {
    const { consumer, usdc, provider, facilitatorSigner } = await loadFixture(localFixture);

    const usdcAddr = await usdc.getAddress();
    const chainId  = (await ethers.provider.getNetwork()).chainId;

    const domain = {
      name: "USD Coin", version: "2",
      chainId, verifyingContract: usdcAddr as `0x${string}`,
    };
    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" },
        { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      ],
    };
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const message = {
      from: consumer.address, to: provider.address, value: PAYMENT_AMOUNT,
      validAfter: 0n, validBefore: BigInt(Math.floor(Date.now() / 1000) + 3600), nonce,
    };

    const sig = await consumer.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(sig);

    const consumerBefore = await usdc.balanceOf(consumer.address);
    const providerBefore = await usdc.balanceOf(provider.address);

    // Facilitator submits the pre-signed transfer (pays only gas, not USDC).
    const settleTx = await (usdc.connect(facilitatorSigner) as typeof usdc)
      .transferWithAuthorization(
        consumer.address, provider.address,
        PAYMENT_AMOUNT, 0n, message.validBefore, nonce, v, r, s
      );
    const receipt = await settleTx.wait();

    const consumerAfter  = await usdc.balanceOf(consumer.address);
    const providerAfter  = await usdc.balanceOf(provider.address);

    console.log(`  Settle tx: ${receipt!.hash}  gas: ${receipt!.gasUsed}`);
    console.log(`  Consumer: ${ethers.formatUnits(consumerBefore,6)} → ${ethers.formatUnits(consumerAfter,6)} USDC`);
    console.log(`  Provider: ${ethers.formatUnits(providerBefore,6)} → ${ethers.formatUnits(providerAfter,6)} USDC`);

    expect(consumerAfter).to.equal(consumerBefore - PAYMENT_AMOUNT, "consumer paid");
    expect(providerAfter).to.equal(providerBefore + PAYMENT_AMOUNT, "provider received");
    console.log(`  Settlement: PASS — 0.01 USDC transferred, facilitator paid only gas`);
  });

  // ── Track 5-6: live hosted services ──────────────────────────────────────

  it("Step 5 — Hosted facilitator health and supported endpoints (live)", async function () {
    if (!FACILITATOR_URL) this.skip();
    const health    = await fetch(`${FACILITATOR_URL}/health`).then(r => r.json());
    const supported = await fetch(`${FACILITATOR_URL}/supported`).then(r => r.json());

    console.log(`  /health:    ${JSON.stringify(health)}`);
    console.log(`  /supported: ${JSON.stringify(supported)}`);

    expect(health.service).to.equal("chainpe-facilitator");
    expect(health.networks).to.include("arbitrum");
    const kind = supported.kinds.find((k: { network: string }) => k.network === "eip155:42161");
    expect(kind, "facilitator supports Arbitrum One").to.not.equal(undefined);
    expect(kind.scheme).to.equal("exact");
    console.log(`  Hosted facilitator reachable: PASS`);
  });

  it("Step 6 — Indexer API returning live mainnet data", async function () {
    if (!INDEXER_URL) this.skip();
    const health = await fetch(`${INDEXER_URL}/health`).then(r => r.json());
    const stats  = await fetch(`${INDEXER_URL}/stats`).then(r => r.json());

    console.log(`  /health: ${JSON.stringify(health)}`);
    console.log(`  /stats:  ${JSON.stringify(stats)}`);

    expect(health.status).to.equal("ok");
    expect(health.network).to.equal("arbitrum");
    expect(Number(health.lastIndexedBlock)).to.be.gt(0);
    console.log(`  Indexer at mainnet block ${health.lastIndexedBlock}: PASS`);
  });

  // ── Track 7: direct mainnet RPC read — proves deployed contracts are live ─

  it("Step 7 — Deployed ChainPeRegistry live on Arbitrum One", async function () {
    if (!MAINNET_REGISTRY) this.skip();
    // Use an Arbitrum One RPC directly — no Hardhat involvement.
    const REGISTRY_ABI = [
      "function registrationFee() external view returns (uint256)",
      "function feeToken() external view returns (address)",
      "function getServiceCount() external view returns (uint256)",
      "function owner() external view returns (address)",
    ];

    const mainnetProvider = new ethers.JsonRpcProvider(MAINNET_RPC);
    const registry = new ethers.Contract(MAINNET_REGISTRY!, REGISTRY_ABI, mainnetProvider);

    const [fee, feeToken, serviceCount, owner] = await Promise.all([
      registry.registrationFee() as Promise<bigint>,
      registry.feeToken()        as Promise<string>,
      registry.getServiceCount() as Promise<bigint>,
      registry.owner()           as Promise<string>,
    ]);

    console.log(`  Registry: ${MAINNET_REGISTRY}`);
    console.log(`  Fee:      ${ethers.formatUnits(fee, 6)} USDC`);
    console.log(`  Token:    ${feeToken}`);
    console.log(`  Owner:    ${owner}`);
    console.log(`  Services: ${serviceCount.toString()}`);

    expect(fee).to.be.gt(0n,               "fee is set");
    expect(feeToken.toLowerCase()).to.equal(MAINNET_USDC.toLowerCase(), "USDC token");
    expect(owner).to.not.equal(ethers.ZeroAddress, "has owner");
    console.log(`  Mainnet registry live: PASS — ${ethers.formatUnits(fee, 6)} USDC fee, ${serviceCount} services`);
  });
});
