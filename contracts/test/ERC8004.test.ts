import { expect } from "chai";
import { ethers } from "hardhat";
import { deployErc8004 } from "../scripts/lib/deployErc8004";

/**
 * Integration tests for the vendored ERC-8004 registries. These prove the
 * official reference contracts deploy via the bootstrap proxy pattern and that
 * the core identity + reputation flow works end-to-end in our Hardhat setup.
 *
 * Note: agent ids are 0-indexed in the reference implementation, and an agent
 * owner/operator cannot leave feedback on its own agent (self-feedback guard),
 * so feedback is given by a separate `client` account.
 */
describe("ERC-8004 (vendored reference contracts)", () => {
  it("deploys all three registries behind proxies and wires identity", async () => {
    const { identityRegistry, reputationRegistry, validationRegistry } = await deployErc8004();
    expect(identityRegistry).to.properAddress;
    expect(reputationRegistry).to.properAddress;
    expect(validationRegistry).to.properAddress;

    const reputation = await ethers.getContractAt(
      "ReputationRegistryUpgradeable",
      reputationRegistry
    );
    expect(await reputation.getIdentityRegistry()).to.equal(identityRegistry);

    const validation = await ethers.getContractAt(
      "ValidationRegistryUpgradeable",
      validationRegistry
    );
    expect(await validation.getIdentityRegistry()).to.equal(identityRegistry);
  });

  it("bootstraps proxies owned by the deployer with initializers consumed", async () => {
    const [deployer] = await ethers.getSigners();
    const { identityRegistry, reputationRegistry, validationRegistry } = await deployErc8004();

    const identity = await ethers.getContractAt("IdentityRegistryUpgradeable", identityRegistry);
    const reputation = await ethers.getContractAt("ReputationRegistryUpgradeable", reputationRegistry);
    const validation = await ethers.getContractAt("ValidationRegistryUpgradeable", validationRegistry);

    // Ownership carried over from the minimal-UUPS bootstrap to the real impls.
    expect(await identity.owner()).to.equal(deployer.address);
    expect(await reputation.owner()).to.equal(deployer.address);
    expect(await validation.owner()).to.equal(deployer.address);

    // The reinitializer(2) slot is consumed — initialize cannot be replayed.
    await expect(identity.initialize()).to.be.revertedWithCustomError(
      identity, "InvalidInitialization"
    );
    await expect(reputation.initialize(identityRegistry)).to.be.revertedWithCustomError(
      reputation, "InvalidInitialization"
    );
    await expect(validation.initialize(identityRegistry)).to.be.revertedWithCustomError(
      validation, "InvalidInitialization"
    );
  });

  it("registers an agent identity (ERC-721) with a token URI", async () => {
    const [provider] = await ethers.getSigners();
    const { identityRegistry } = await deployErc8004();
    const identity = await ethers.getContractAt("IdentityRegistryUpgradeable", identityRegistry);

    await expect(identity.connect(provider)["register(string)"]("ipfs://agent-card.json"))
      .to.emit(identity, "Registered")
      .withArgs(0n, "ipfs://agent-card.json", provider.address);

    // agentId 0 is the first agent; owner is the provider.
    expect(await identity.ownerOf(0n)).to.equal(provider.address);
    expect(await identity.tokenURI(0n)).to.equal("ipfs://agent-card.json");
  });

  it("lets a client leave feedback and reads it back via getSummary", async () => {
    const [provider, client] = await ethers.getSigners();
    const { identityRegistry, reputationRegistry } = await deployErc8004();
    const identity = await ethers.getContractAt("IdentityRegistryUpgradeable", identityRegistry);
    const reputation = await ethers.getContractAt(
      "ReputationRegistryUpgradeable",
      reputationRegistry
    );

    await identity.connect(provider)["register(string)"]("ipfs://weather-agent");
    const agentId = 0n;

    // value 90 with 0 decimals, tagged "quality"/"weather" (x402 use case).
    await expect(
      reputation
        .connect(client)
        .giveFeedback(agentId, 90, 0, "quality", "weather", "https://weather.example.com", "", ethers.ZeroHash)
    )
      .to.emit(reputation, "NewFeedback");

    const [count, summaryValue] = await reputation.getSummary(
      agentId,
      [client.address],
      "",
      ""
    );
    expect(count).to.equal(1n);
    expect(summaryValue).to.equal(90n);
  });

  it("blocks self-feedback from the agent owner", async () => {
    const [provider] = await ethers.getSigners();
    const { identityRegistry, reputationRegistry } = await deployErc8004();
    const identity = await ethers.getContractAt("IdentityRegistryUpgradeable", identityRegistry);
    const reputation = await ethers.getContractAt(
      "ReputationRegistryUpgradeable",
      reputationRegistry
    );

    await identity.connect(provider)["register(string)"]("ipfs://agent");
    await expect(
      reputation
        .connect(provider)
        .giveFeedback(0n, 50, 0, "quality", "", "", "", ethers.ZeroHash)
    ).to.be.revertedWith("Self-feedback not allowed");
  });

  it("ChainPeRegistry can link a service to an ERC-8004 agentId", async () => {
    const [owner, dev, treasury] = await ethers.getSigners();
    const { identityRegistry } = await deployErc8004();
    const identity = await ethers.getContractAt("IdentityRegistryUpgradeable", identityRegistry);
    await identity.connect(dev)["register(string)"]("ipfs://dev-agent");
    const agentId = 0n;

    const Usdc = await ethers.getContractFactory("MockUSDC");
    const usdc = await Usdc.deploy();
    const Registry = await ethers.getContractFactory("ChainPeRegistry");
    const registry = await Registry.deploy(
      await usdc.getAddress(),
      treasury.address,
      0, // zero fee for simplicity here
      identityRegistry, // wire ERC-8004 identity registry
      owner.address
    );

    expect(await registry.identityRegistry()).to.equal(identityRegistry);

    await registry.connect(dev).register({
      name: "Weather API",
      description: "Weather data",
      tags: "weather",
      endpoint: "https://weather.example.com",
      pricePerRequest: "0.01",
      paymentToken: "USDC",
      network: "arbitrum-sepolia",
      payTo: dev.address,
      agentId,
    });

    const svc = await registry.getService(dev.address, "Weather API");
    expect(svc.agentId).to.equal(agentId);
  });
});
