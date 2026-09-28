import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { ChainPeRegistry, MockUSDC } from "../typechain-types";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const FEE = ethers.parseUnits("1.0", 6); // 1 USDC
const ZERO = ethers.ZeroAddress;

function input(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: "Weather API",
    description: "Real-time weather and forecast data",
    tags: "weather,forecast,data",
    endpoint: "https://weather.example.com",
    pricePerRequest: "0.01",
    paymentToken: "USDC",
    network: "arbitrum-sepolia",
    payTo: "0x000000000000000000000000000000000000dEaD",
    agentId: 0n,
    ...overrides,
  };
}

describe("ChainPeRegistry", () => {
  async function deployFixture() {
    const [owner, dev, dev2, treasury, other] = await ethers.getSigners();

    const Usdc = await ethers.getContractFactory("MockUSDC");
    const usdc = (await Usdc.deploy()) as unknown as MockUSDC;
    await usdc.waitForDeployment();

    const Registry = await ethers.getContractFactory("ChainPeRegistry");
    const registry = (await Registry.deploy(
      await usdc.getAddress(),
      treasury.address,
      FEE,
      ZERO,
      owner.address
    )) as unknown as ChainPeRegistry;
    await registry.waitForDeployment();

    // Fund + approve developers.
    for (const s of [dev, dev2]) {
      await usdc.mint(s.address, ethers.parseUnits("100", 6));
      await usdc.connect(s).approve(await registry.getAddress(), ethers.MaxUint256);
    }

    return { registry, usdc, owner, dev, dev2, treasury, other };
  }

  // --- Deployment -----------------------------------------------------------
  describe("Deployment", () => {
    it("sets constructor params", async () => {
      const { registry, usdc, owner, treasury } = await loadFixture(deployFixture);
      expect(await registry.feeToken()).to.equal(await usdc.getAddress());
      expect(await registry.feeRecipient()).to.equal(treasury.address);
      expect(await registry.registrationFee()).to.equal(FEE);
      expect(await registry.identityRegistry()).to.equal(ZERO);
      expect(await registry.owner()).to.equal(owner.address);
      expect(await registry.getServiceCount()).to.equal(0n);
    });

    it("reverts on zero addresses", async () => {
      const [owner, treasury] = await ethers.getSigners();
      const Usdc = await ethers.getContractFactory("MockUSDC");
      const usdc = await Usdc.deploy();
      const Registry = await ethers.getContractFactory("ChainPeRegistry");
      await expect(
        Registry.deploy(ZERO, treasury.address, FEE, ZERO, owner.address)
      ).to.be.revertedWithCustomError(Registry, "ZeroAddress");
      await expect(
        Registry.deploy(await usdc.getAddress(), ZERO, FEE, ZERO, owner.address)
      ).to.be.revertedWithCustomError(Registry, "ZeroAddress");
    });
  });

  // --- register -------------------------------------------------------------
  describe("register", () => {
    it("stores a service, charges the fee, and emits", async () => {
      const { registry, usdc, dev, treasury } = await loadFixture(deployFixture);
      const key = await registry.computeKey(dev.address, "Weather API");

      await expect(registry.connect(dev).register(input()))
        .to.emit(registry, "ServiceRegistered")
        .withArgs(
          key,
          dev.address,
          "Weather API",
          "https://weather.example.com",
          "0.01",
          "USDC",
          "0x000000000000000000000000000000000000dEaD",
          0n
        )
        .and.to.emit(registry, "RegistrationFeePaid")
        .withArgs(dev.address, treasury.address, FEE);

      expect(await usdc.balanceOf(treasury.address)).to.equal(FEE);
      expect(await registry.getServiceCount()).to.equal(1n);

      const svc = await registry.getService(dev.address, "Weather API");
      expect(svc.developer).to.equal(dev.address);
      expect(svc.exists).to.equal(true);
      expect(svc.description).to.equal("Real-time weather and forecast data");
      expect(svc.createdAt).to.equal(svc.updatedAt);
    });

    it("reverts on duplicate (developer, name)", async () => {
      const { registry, dev } = await loadFixture(deployFixture);
      await registry.connect(dev).register(input());
      await expect(registry.connect(dev).register(input())).to.be.revertedWithCustomError(
        registry,
        "ServiceAlreadyExists"
      );
    });

    it("allows two developers to use the same name", async () => {
      const { registry, dev, dev2 } = await loadFixture(deployFixture);
      await registry.connect(dev).register(input());
      await registry.connect(dev2).register(input());
      expect(await registry.getServiceCount()).to.equal(2n);
      expect(await registry.hasService(dev.address, "Weather API")).to.equal(true);
      expect(await registry.hasService(dev2.address, "Weather API")).to.equal(true);
    });

    it("reverts on empty name and zero payTo", async () => {
      const { registry, dev } = await loadFixture(deployFixture);
      await expect(
        registry.connect(dev).register(input({ name: "" }))
      ).to.be.revertedWithCustomError(registry, "EmptyName");
      await expect(
        registry.connect(dev).register(input({ payTo: ZERO }))
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("reverts when the fee is not approved", async () => {
      const { registry, usdc, other } = await loadFixture(deployFixture);
      await usdc.mint(other.address, ethers.parseUnits("5", 6));
      // other has NOT approved
      await expect(registry.connect(other).register(input())).to.be.reverted;
    });

    it("skips fee transfer when registrationFee is zero", async () => {
      const { registry, usdc, owner, other } = await loadFixture(deployFixture);
      await registry.connect(owner).setRegistrationFee(0);
      // `other` has neither funds nor approval, but a zero fee needs neither.
      await expect(registry.connect(other).register(input())).to.emit(
        registry,
        "ServiceRegistered"
      );
      expect(await usdc.balanceOf(await registry.feeRecipient())).to.equal(0n);
    });

    it("stores the ERC-8004 agentId link", async () => {
      const { registry, dev } = await loadFixture(deployFixture);
      await registry.connect(dev).register(input({ agentId: 42n }));
      const svc = await registry.getService(dev.address, "Weather API");
      expect(svc.agentId).to.equal(42n);
    });
  });

  // --- update ---------------------------------------------------------------
  describe("update", () => {
    it("updates fields, preserves createdAt/developer; update is free by default", async () => {
      const { registry, usdc, dev, owner, treasury } = await loadFixture(deployFixture);
      await registry.connect(dev).register(input());
      const before = await registry.getService(dev.address, "Weather API");

      await ethers.provider.send("evm_increaseTime", [10]);
      await expect(
        registry.connect(dev).update(
          input({ description: "Updated desc", pricePerRequest: "0.02", agentId: 7n })
        )
      ).to.emit(registry, "ServiceUpdated");

      const after = await registry.getService(dev.address, "Weather API");
      expect(after.description).to.equal("Updated desc");
      expect(after.pricePerRequest).to.equal("0.02");
      expect(after.agentId).to.equal(7n);
      expect(after.createdAt).to.equal(before.createdAt);
      expect(after.updatedAt).to.be.greaterThan(before.updatedAt);
      // updateFee defaults to 0 — only the registration fee was collected.
      expect(await usdc.balanceOf(treasury.address)).to.equal(FEE);
    });

    it("owner can set updateFee; update then charges that fee", async () => {
      const { registry, usdc, dev, owner, treasury } = await loadFixture(deployFixture);
      await registry.connect(dev).register(input());
      const UPDATE_FEE = ethers.parseUnits("0.05", 6);
      await expect(registry.connect(owner).setUpdateFee(UPDATE_FEE))
        .to.emit(registry, "UpdateFeeUpdated")
        .withArgs(0n, UPDATE_FEE);
      expect(await registry.updateFee()).to.equal(UPDATE_FEE);

      await registry.connect(dev).update(input({ description: "Charged update" }));
      // Treasury received register fee + update fee.
      expect(await usdc.balanceOf(treasury.address)).to.equal(FEE + UPDATE_FEE);
    });

    it("reverts updating a non-existent service", async () => {
      const { registry, dev } = await loadFixture(deployFixture);
      await expect(registry.connect(dev).update(input())).to.be.revertedWithCustomError(
        registry,
        "ServiceNotFound"
      );
    });

    it("a different developer cannot update another's listing (separate key)", async () => {
      const { registry, dev, dev2 } = await loadFixture(deployFixture);
      await registry.connect(dev).register(input());
      // dev2 computes a different key, so it appears as "not found" for dev2.
      await expect(registry.connect(dev2).update(input())).to.be.revertedWithCustomError(
        registry,
        "ServiceNotFound"
      );
    });
  });

  // --- deregister -----------------------------------------------------------
  describe("deregister", () => {
    it("removes a service and emits", async () => {
      const { registry, dev } = await loadFixture(deployFixture);
      await registry.connect(dev).register(input());
      await expect(registry.connect(dev).deregister("Weather API")).to.emit(
        registry,
        "ServiceDeregistered"
      );
      expect(await registry.hasService(dev.address, "Weather API")).to.equal(false);
      expect(await registry.getServiceCount()).to.equal(0n);
      await expect(registry.getService(dev.address, "Weather API")).to.be.revertedWithCustomError(
        registry,
        "ServiceNotFound"
      );
    });

    it("reverts deregistering a non-existent service", async () => {
      const { registry, dev } = await loadFixture(deployFixture);
      await expect(
        registry.connect(dev).deregister("Nope")
      ).to.be.revertedWithCustomError(registry, "ServiceNotFound");
    });

    it("swap-and-pop keeps enumeration consistent", async () => {
      const { registry, dev } = await loadFixture(deployFixture);
      await registry.connect(dev).register(input({ name: "A" }));
      await registry.connect(dev).register(input({ name: "B" }));
      await registry.connect(dev).register(input({ name: "C" }));
      expect(await registry.getServiceCount()).to.equal(3n);

      await registry.connect(dev).deregister("A"); // removes first; C swaps in
      expect(await registry.getServiceCount()).to.equal(2n);

      const all = await registry.getServices(0, 10);
      const names = all.map((s) => s.name).sort();
      expect(names).to.deep.equal(["B", "C"]);
    });
  });

  // --- pagination -----------------------------------------------------------
  describe("getServices pagination", () => {
    it("returns the requested page", async () => {
      const { registry, dev } = await loadFixture(deployFixture);
      for (let i = 0; i < 5; i++) {
        await registry.connect(dev).register(input({ name: `S${i}` }));
      }
      const page1 = await registry.getServices(0, 2);
      const page2 = await registry.getServices(2, 2);
      const page3 = await registry.getServices(4, 10); // clamps to remaining 1
      expect(page1.length).to.equal(2);
      expect(page2.length).to.equal(2);
      expect(page3.length).to.equal(1);
    });

    it("offset == total returns empty; offset > total reverts", async () => {
      const { registry, dev } = await loadFixture(deployFixture);
      await registry.connect(dev).register(input());
      const empty = await registry.getServices(1, 5);
      expect(empty.length).to.equal(0);
      await expect(registry.getServices(2, 5)).to.be.revertedWithCustomError(
        registry,
        "InvalidPagination"
      );
    });

    it("limit == 0 reverts", async () => {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.getServices(0, 0)).to.be.revertedWithCustomError(
        registry,
        "InvalidPagination"
      );
    });
  });

  // --- admin / access control ----------------------------------------------
  describe("admin", () => {
    it("only owner can set fee params", async () => {
      const { registry, dev } = await loadFixture(deployFixture);
      await expect(registry.connect(dev).setRegistrationFee(123)).to.be.revertedWithCustomError(
        registry,
        "OwnableUnauthorizedAccount"
      );
      await expect(
        registry.connect(dev).setFeeRecipient(dev.address)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
      await expect(
        registry.connect(dev).setIdentityRegistry(dev.address)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("owner updates fee, recipient, token, identity registry", async () => {
      const { registry, owner, dev } = await loadFixture(deployFixture);
      await expect(registry.connect(owner).setRegistrationFee(0))
        .to.emit(registry, "RegistrationFeeUpdated")
        .withArgs(FEE, 0);
      await expect(registry.connect(owner).setFeeRecipient(dev.address))
        .to.emit(registry, "FeeRecipientUpdated");
      await expect(registry.connect(owner).setIdentityRegistry(dev.address))
        .to.emit(registry, "IdentityRegistryUpdated");
      expect(await registry.identityRegistry()).to.equal(dev.address);
    });

    it("uses Ownable2Step for ownership transfer", async () => {
      const { registry, owner, other } = await loadFixture(deployFixture);
      await registry.connect(owner).transferOwnership(other.address);
      expect(await registry.owner()).to.equal(owner.address); // not yet
      await registry.connect(other).acceptOwnership();
      expect(await registry.owner()).to.equal(other.address);
    });

    it("setFeeToken updates token and rejects zero / non-owner", async () => {
      const { registry, owner, dev } = await loadFixture(deployFixture);
      const Usdc = await ethers.getContractFactory("MockUSDC");
      const usdc2 = await Usdc.deploy();
      await expect(registry.connect(owner).setFeeToken(await usdc2.getAddress()))
        .to.emit(registry, "FeeTokenUpdated");
      expect(await registry.feeToken()).to.equal(await usdc2.getAddress());
      await expect(registry.connect(owner).setFeeToken(ZERO)).to.be.revertedWithCustomError(
        registry,
        "ZeroAddress"
      );
      await expect(
        registry.connect(dev).setFeeToken(await usdc2.getAddress())
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("setFeeRecipient rejects zero address", async () => {
      const { registry, owner } = await loadFixture(deployFixture);
      await expect(registry.connect(owner).setFeeRecipient(ZERO)).to.be.revertedWithCustomError(
        registry,
        "ZeroAddress"
      );
    });
  });

  // --- views ----------------------------------------------------------------
  describe("views", () => {
    it("getServiceByKey returns the service and reverts when absent", async () => {
      const { registry, dev } = await loadFixture(deployFixture);
      await registry.connect(dev).register(input());
      const key = await registry.computeKey(dev.address, "Weather API");
      const svc = await registry.getServiceByKey(key);
      expect(svc.name).to.equal("Weather API");
      await expect(
        registry.getServiceByKey(ethers.id("missing"))
      ).to.be.revertedWithCustomError(registry, "ServiceNotFound");
    });

    it("getServiceKeyAt mirrors computeKey", async () => {
      const { registry, dev } = await loadFixture(deployFixture);
      await registry.connect(dev).register(input());
      const key = await registry.computeKey(dev.address, "Weather API");
      expect(await registry.getServiceKeyAt(0)).to.equal(key);
    });
  });

  // --- string length validation -------------------------------------------
  describe("string length validation", () => {
    it("rejects a name longer than 64 bytes", async () => {
      const { registry, dev } = await loadFixture(deployFixture);
      const longName = "A".repeat(65);
      await expect(
        registry.connect(dev).register(input({ name: longName }))
      ).to.be.revertedWithCustomError(registry, "StringTooLong");
    });

    it("rejects a description longer than 1024 bytes", async () => {
      const { registry, dev } = await loadFixture(deployFixture);
      const longDesc = "D".repeat(1025);
      await expect(
        registry.connect(dev).register(input({ description: longDesc }))
      ).to.be.revertedWithCustomError(registry, "StringTooLong");
    });

    it("rejects an endpoint longer than 256 bytes on update", async () => {
      const { registry, dev } = await loadFixture(deployFixture);
      await registry.connect(dev).register(input());
      const longEndpoint = "https://example.com/" + "p".repeat(240);
      await expect(
        registry.connect(dev).update(input({ endpoint: longEndpoint }))
      ).to.be.revertedWithCustomError(registry, "StringTooLong");
    });

    it("accepts strings at the boundary", async () => {
      const { registry, dev } = await loadFixture(deployFixture);
      const boundaryName = "A".repeat(64);
      await expect(
        registry.connect(dev).register(input({ name: boundaryName }))
      ).to.emit(registry, "ServiceRegistered");
    });
  });

  // --- getServices limit cap -----------------------------------------------
  describe("getServices page size cap", () => {
    it("reverts when limit exceeds MAX_SERVICES_PER_PAGE (100)", async () => {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.getServices(0, 101)).to.be.revertedWithCustomError(
        registry, "InvalidPagination"
      );
    });

    it("accepts limit == 100", async () => {
      const { registry, dev } = await loadFixture(deployFixture);
      await registry.connect(dev).register(input());
      const page = await registry.getServices(0, 100);
      expect(page.length).to.equal(1);
    });
  });

  // --- ownerWithdraw -------------------------------------------------------
  describe("ownerWithdraw", () => {
    it("owner can rescue accidentally sent tokens", async () => {
      const { registry, usdc, owner, dev } = await loadFixture(deployFixture);
      // Simulate tokens stuck in the contract by a direct transfer.
      await usdc.mint(owner.address, ethers.parseUnits("5", 6));
      await usdc.connect(owner).transfer(await registry.getAddress(), ethers.parseUnits("5", 6));

      const before = await usdc.balanceOf(owner.address);
      await registry.connect(owner).ownerWithdraw(await usdc.getAddress(), ethers.parseUnits("5", 6));
      expect(await usdc.balanceOf(owner.address)).to.equal(before + ethers.parseUnits("5", 6));
    });

    it("non-owner cannot call ownerWithdraw", async () => {
      const { registry, usdc, dev } = await loadFixture(deployFixture);
      await expect(
        registry.connect(dev).ownerWithdraw(await usdc.getAddress(), 1n)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });
  });

  // --- pause / unpause -----------------------------------------------------
  describe("pause / unpause", () => {
    it("owner can pause; non-owner cannot", async () => {
      const { registry, owner, dev } = await loadFixture(deployFixture);
      await expect(registry.connect(dev).pause()).to.be.revertedWithCustomError(
        registry, "OwnableUnauthorizedAccount"
      );
      await registry.connect(owner).pause();
      await expect(registry.connect(dev).unpause()).to.be.revertedWithCustomError(
        registry, "OwnableUnauthorizedAccount"
      );
      await registry.connect(owner).unpause();
    });

    it("register, update, and deregister revert when paused", async () => {
      const { registry, owner, dev } = await loadFixture(deployFixture);
      await registry.connect(dev).register(input());
      await registry.connect(owner).pause();

      await expect(registry.connect(dev).register(input({ name: "NewService" }))).to.be.revertedWithCustomError(
        registry, "EnforcedPause"
      );
      await expect(registry.connect(dev).update(input({ description: "Updated" }))).to.be.revertedWithCustomError(
        registry, "EnforcedPause"
      );
      await expect(registry.connect(dev).deregister("Weather API")).to.be.revertedWithCustomError(
        registry, "EnforcedPause"
      );

      // unpause restores normal operation
      await registry.connect(owner).unpause();
      await expect(registry.connect(dev).deregister("Weather API")).to.emit(registry, "ServiceDeregistered");
    });
  });
});
