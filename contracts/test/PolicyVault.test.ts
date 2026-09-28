import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { PolicyVault, MockUSDC } from "../typechain-types";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const USDC = (n: string) => ethers.parseUnits(n, 6);

describe("PolicyVault", () => {
  async function deployFixture() {
    const [owner, agent, relayer, provider, other] = await ethers.getSigners();

    const Usdc = await ethers.getContractFactory("MockUSDC");
    const usdc = (await Usdc.deploy()) as unknown as MockUSDC;
    await usdc.waitForDeployment();

    const Vault = await ethers.getContractFactory("PolicyVault");
    const vault = (await Vault.deploy(await usdc.getAddress())) as unknown as PolicyVault;
    await vault.waitForDeployment();

    // Owner funds the vault with 1000 USDC.
    await usdc.mint(owner.address, USDC("1000"));
    await usdc.connect(owner).approve(await vault.getAddress(), USDC("1000"));
    await vault.connect(owner).deposit(USDC("1000"));

    return { usdc, vault, owner, agent, relayer, provider, other };
  }

  async function setDefaultPolicy(
    vault: PolicyVault,
    owner: HardhatEthersSigner,
    agent: HardhatEthersSigner,
    overrides: Partial<{
      maxPerCall: bigint;
      dailyCap: bigint;
      totalBudget: bigint;
      expiry: number;
      allowlistOnly: boolean;
    }> = {}
  ) {
    const expiry = overrides.expiry ?? (await time.latest()) + 3600;
    await vault
      .connect(owner)
      .setPolicy(
        agent.address,
        overrides.maxPerCall ?? USDC("10"),
        overrides.dailyCap ?? USDC("20"),
        overrides.totalBudget ?? USDC("50"),
        expiry,
        overrides.allowlistOnly ?? false
      );
  }

  async function signSpend(
    vault: PolicyVault,
    signer: HardhatEthersSigner,
    owner: string,
    to: string,
    amount: bigint,
    nonce: bigint,
    deadline: number
  ) {
    const { chainId } = await ethers.provider.getNetwork();
    const domain = {
      name: "ChainPePolicyVault",
      version: "1",
      chainId,
      verifyingContract: await vault.getAddress(),
    };
    const types = {
      Spend: [
        { name: "owner", type: "address" },
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    return signer.signTypedData(domain, types, { owner, to, amount, nonce, deadline });
  }

  describe("funding", () => {
    it("tracks deposits and withdrawals", async () => {
      const { vault, usdc, owner } = await loadFixture(deployFixture);
      expect(await vault.balanceOf(owner.address)).to.equal(USDC("1000"));
      await vault.connect(owner).withdraw(USDC("400"));
      expect(await vault.balanceOf(owner.address)).to.equal(USDC("600"));
      expect(await usdc.balanceOf(owner.address)).to.equal(USDC("400"));
      await expect(vault.connect(owner).withdraw(USDC("601"))).to.be.revertedWithCustomError(
        vault,
        "InsufficientBalance"
      );
    });
  });

  describe("gasless spend within policy", () => {
    it("a relayer settles a session-signed spend; the agent pays no gas", async () => {
      const { vault, usdc, owner, agent, relayer, provider } =
        await loadFixture(deployFixture);
      await setDefaultPolicy(vault, owner, agent);

      const deadline = (await time.latest()) + 600;
      const sig = await signSpend(
        vault,
        agent,
        owner.address,
        provider.address,
        USDC("5"),
        0n,
        deadline
      );

      const agentEthBefore = await ethers.provider.getBalance(agent.address);
      await expect(
        vault.connect(relayer).spend(owner.address, provider.address, USDC("5"), deadline, sig)
      )
        .to.emit(vault, "Spent")
        .withArgs(owner.address, provider.address, USDC("5"), relayer.address, 0n);

      // Provider got paid; vault balance + nonce updated; agent spent NO gas.
      expect(await usdc.balanceOf(provider.address)).to.equal(USDC("5"));
      expect(await vault.balanceOf(owner.address)).to.equal(USDC("995"));
      expect(await vault.nonces(owner.address)).to.equal(1n);
      expect(await ethers.provider.getBalance(agent.address)).to.equal(agentEthBefore);
    });
  });

  describe("on-chain policy enforcement", () => {
    it("rejects a spend over the per-call cap", async () => {
      const { vault, owner, agent, relayer, provider } = await loadFixture(deployFixture);
      await setDefaultPolicy(vault, owner, agent, { maxPerCall: USDC("10") });
      const deadline = (await time.latest()) + 600;
      const sig = await signSpend(vault, agent, owner.address, provider.address, USDC("11"), 0n, deadline);
      await expect(
        vault.connect(relayer).spend(owner.address, provider.address, USDC("11"), deadline, sig)
      ).to.be.revertedWithCustomError(vault, "OverPerCallCap");
    });

    it("rejects a spend over the daily cap", async () => {
      const { vault, owner, agent, relayer, provider } = await loadFixture(deployFixture);
      await setDefaultPolicy(vault, owner, agent, { maxPerCall: USDC("15"), dailyCap: USDC("20") });
      const d1 = (await time.latest()) + 600;
      const s1 = await signSpend(vault, agent, owner.address, provider.address, USDC("15"), 0n, d1);
      await vault.connect(relayer).spend(owner.address, provider.address, USDC("15"), d1, s1);
      const d2 = (await time.latest()) + 600;
      const s2 = await signSpend(vault, agent, owner.address, provider.address, USDC("15"), 1n, d2);
      await expect(
        vault.connect(relayer).spend(owner.address, provider.address, USDC("15"), d2, s2)
      ).to.be.revertedWithCustomError(vault, "OverDailyCap");
    });

    it("rejects a spend over the total budget", async () => {
      const { vault, owner, agent, relayer, provider } = await loadFixture(deployFixture);
      // maxPerCall must be <= totalBudget; use equal values so the first spend exhausts the budget.
      await setDefaultPolicy(vault, owner, agent, { totalBudget: USDC("8"), maxPerCall: USDC("8") });
      const d1 = (await time.latest()) + 600;
      const s1 = await signSpend(vault, agent, owner.address, provider.address, USDC("8"), 0n, d1);
      await vault.connect(relayer).spend(owner.address, provider.address, USDC("8"), d1, s1);
      const d2 = (await time.latest()) + 600;
      const s2 = await signSpend(vault, agent, owner.address, provider.address, USDC("1"), 1n, d2);
      await expect(
        vault.connect(relayer).spend(owner.address, provider.address, USDC("1"), d2, s2)
      ).to.be.revertedWithCustomError(vault, "OverTotalBudget");
    });

    it("enforces the recipient allowlist when allowlistOnly is set", async () => {
      const { vault, owner, agent, relayer, provider, other } = await loadFixture(deployFixture);
      await setDefaultPolicy(vault, owner, agent, { allowlistOnly: true });

      const d1 = (await time.latest()) + 600;
      const sBad = await signSpend(vault, agent, owner.address, other.address, USDC("5"), 0n, d1);
      await expect(
        vault.connect(relayer).spend(owner.address, other.address, USDC("5"), d1, sBad)
      ).to.be.revertedWithCustomError(vault, "RecipientNotAllowlisted");

      await vault.connect(owner).setAllowlist(provider.address, true);
      const sOk = await signSpend(vault, agent, owner.address, provider.address, USDC("5"), 0n, d1);
      await expect(
        vault.connect(relayer).spend(owner.address, provider.address, USDC("5"), d1, sOk)
      ).to.emit(vault, "Spent");
    });

    it("rejects an expired session and an expired auth deadline", async () => {
      const { vault, owner, agent, relayer, provider } = await loadFixture(deployFixture);
      const expiry = (await time.latest()) + 100;
      await setDefaultPolicy(vault, owner, agent, { expiry });

      // auth deadline in the past
      const past = (await time.latest()) - 1;
      const sPast = await signSpend(vault, agent, owner.address, provider.address, USDC("5"), 0n, past);
      await expect(
        vault.connect(relayer).spend(owner.address, provider.address, USDC("5"), past, sPast)
      ).to.be.revertedWithCustomError(vault, "AuthExpired");

      // advance past session expiry
      await time.increaseTo(expiry + 10);
      const d = (await time.latest()) + 600;
      const s = await signSpend(vault, agent, owner.address, provider.address, USDC("5"), 0n, d);
      await expect(
        vault.connect(relayer).spend(owner.address, provider.address, USDC("5"), d, s)
      ).to.be.revertedWithCustomError(vault, "SessionExpired");
    });

    it("rejects a bad session signature and replayed authorizations", async () => {
      const { vault, owner, agent, relayer, provider, other } = await loadFixture(deployFixture);
      await setDefaultPolicy(vault, owner, agent);
      const d = (await time.latest()) + 600;

      // signed by the wrong key
      const bad = await signSpend(vault, other, owner.address, provider.address, USDC("5"), 0n, d);
      await expect(
        vault.connect(relayer).spend(owner.address, provider.address, USDC("5"), d, bad)
      ).to.be.revertedWithCustomError(vault, "BadSessionSig");

      // valid once…
      const good = await signSpend(vault, agent, owner.address, provider.address, USDC("5"), 0n, d);
      await vault.connect(relayer).spend(owner.address, provider.address, USDC("5"), d, good);
      // …replay fails (nonce advanced)
      await expect(
        vault.connect(relayer).spend(owner.address, provider.address, USDC("5"), d, good)
      ).to.be.revertedWithCustomError(vault, "BadSessionSig");
    });

    it("rejects spends after the owner revokes the session", async () => {
      const { vault, owner, agent, relayer, provider } = await loadFixture(deployFixture);
      await setDefaultPolicy(vault, owner, agent);
      await vault.connect(owner).revokeSession();
      const d = (await time.latest()) + 600;
      const sig = await signSpend(vault, agent, owner.address, provider.address, USDC("5"), 0n, d);
      await expect(
        vault.connect(relayer).spend(owner.address, provider.address, USDC("5"), d, sig)
      ).to.be.revertedWithCustomError(vault, "SessionInactive");
    });

    it("rejects a spend exceeding the vault balance", async () => {
      const { vault, owner, agent, relayer, provider } = await loadFixture(deployFixture);
      await setDefaultPolicy(vault, owner, agent, { maxPerCall: USDC("10") });
      await vault.connect(owner).withdraw(USDC("997")); // leave 3 USDC
      const d = (await time.latest()) + 600;
      const sig = await signSpend(vault, agent, owner.address, provider.address, USDC("5"), 0n, d);
      await expect(
        vault.connect(relayer).spend(owner.address, provider.address, USDC("5"), d, sig)
      ).to.be.revertedWithCustomError(vault, "InsufficientVaultBalance");
    });
  });

  describe("views", () => {
    it("reports remaining daily + budget allowances", async () => {
      const { vault, owner, agent, relayer, provider } = await loadFixture(deployFixture);
      await setDefaultPolicy(vault, owner, agent, {
        dailyCap: USDC("20"),
        totalBudget: USDC("50"),
      });
      const d = (await time.latest()) + 600;
      const sig = await signSpend(vault, agent, owner.address, provider.address, USDC("5"), 0n, d);
      await vault.connect(relayer).spend(owner.address, provider.address, USDC("5"), d, sig);
      expect(await vault.dailyRemaining(owner.address)).to.equal(USDC("15"));
      expect(await vault.budgetRemaining(owner.address)).to.equal(USDC("45"));
    });
  });

  describe("previewSpend view", () => {
    it("returns ok=true when all constraints are satisfied", async () => {
      const { vault, owner, agent, provider } = await loadFixture(deployFixture);
      await setDefaultPolicy(vault, owner, agent);
      const [ok, reason] = await vault.previewSpend(owner.address, provider.address, USDC("5"));
      expect(ok).to.equal(true);
      expect(reason).to.equal("");
    });

    it("returns ok=false with 'session inactive' after revoking", async () => {
      const { vault, owner, agent, provider } = await loadFixture(deployFixture);
      await setDefaultPolicy(vault, owner, agent);
      await vault.connect(owner).revokeSession();
      const [ok, reason] = await vault.previewSpend(owner.address, provider.address, USDC("5"));
      expect(ok).to.equal(false);
      expect(reason).to.equal("session inactive");
    });

    it("returns ok=false with 'over per-call cap' when amount exceeds cap", async () => {
      const { vault, owner, agent, provider } = await loadFixture(deployFixture);
      await setDefaultPolicy(vault, owner, agent, { maxPerCall: USDC("10") });
      const [ok, reason] = await vault.previewSpend(owner.address, provider.address, USDC("11"));
      expect(ok).to.equal(false);
      expect(reason).to.equal("over per-call cap");
    });

    it("returns ok=false with 'recipient not allowlisted' when allowlistOnly is set", async () => {
      const { vault, owner, agent, other } = await loadFixture(deployFixture);
      await setDefaultPolicy(vault, owner, agent, { allowlistOnly: true });
      const [ok, reason] = await vault.previewSpend(owner.address, other.address, USDC("5"));
      expect(ok).to.equal(false);
      expect(reason).to.equal("recipient not allowlisted");
    });
  });

  describe("setPolicy validation", () => {
    it("rejects setPolicy with dailyCap == 0", async () => {
      const { vault, owner, agent } = await loadFixture(deployFixture);
      const expiry = (await time.latest()) + 3600;
      await expect(
        vault.connect(owner).setPolicy(agent.address, USDC("5"), 0, USDC("50"), expiry, false)
      ).to.be.revertedWithCustomError(vault, "ZeroDailyCap");
    });

    it("rejects setPolicy with maxPerCall > totalBudget", async () => {
      const { vault, owner, agent } = await loadFixture(deployFixture);
      const expiry = (await time.latest()) + 3600;
      await expect(
        vault.connect(owner).setPolicy(agent.address, USDC("20"), USDC("20"), USDC("10"), expiry, false)
      ).to.be.revertedWithCustomError(vault, "MaxPerCallExceedsBudget");
    });

    it("rejects setPolicy with expiry in the past", async () => {
      const { vault, owner, agent } = await loadFixture(deployFixture);
      const past = (await time.latest()) - 1;
      await expect(
        vault.connect(owner).setPolicy(agent.address, USDC("5"), USDC("20"), USDC("50"), past, false)
      ).to.be.revertedWithCustomError(vault, "ExpiryInPast");
    });
  });

  describe("pause / unpause", () => {
    it("owner can pause and unpause; non-owner cannot", async () => {
      const { vault, owner, other } = await loadFixture(deployFixture);
      await expect(vault.connect(other).pause()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
      await vault.connect(owner).pause();
      await expect(vault.connect(other).unpause()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
      await vault.connect(owner).unpause();
    });

    it("pause blocks deposit + spend but withdraw always works", async () => {
      const { vault, usdc, owner, agent, relayer, provider } = await loadFixture(deployFixture);
      await setDefaultPolicy(vault, owner, agent);
      await vault.connect(owner).pause();

      // deposit
      await usdc.mint(owner.address, USDC("10"));
      await usdc.connect(owner).approve(await vault.getAddress(), USDC("10"));
      await expect(vault.connect(owner).deposit(USDC("10"))).to.be.revertedWithCustomError(
        vault, "EnforcedPause"
      );

      // withdraw stays available even while paused — users must be able to exit.
      await expect(vault.connect(owner).withdraw(USDC("1"))).to.emit(vault, "Withdrawn");

      // spend
      const d = (await time.latest()) + 600;
      const sig = await signSpend(vault, agent, owner.address, provider.address, USDC("5"), 0n, d);
      await expect(
        vault.connect(relayer).spend(owner.address, provider.address, USDC("5"), d, sig)
      ).to.be.revertedWithCustomError(vault, "EnforcedPause");

      // unpause restores normal operation
      await vault.connect(owner).unpause();
      await expect(vault.connect(owner).deposit(USDC("10"))).to.emit(vault, "Deposited");
    });
  });

  // --- cleanupDailySpent -------------------------------------------------------
  describe("cleanupDailySpent", () => {
    it("clears a past day slot and reverts when trying to clear today", async () => {
      const { vault, usdc, owner, agent, relayer, provider } = await loadFixture(deployFixture);
      await setDefaultPolicy(vault, owner, agent);

      // Spend once to write to dailySpent for today.
      const d = (await time.latest()) + 600;
      const sig = await signSpend(vault, agent, owner.address, provider.address, USDC("5"), 0n, d);
      await vault.connect(relayer).spend(owner.address, provider.address, USDC("5"), d, sig);
      const today = Math.floor((await time.latest()) / 86400);
      expect(await vault.dailySpent(owner.address, today)).to.be.gt(0n);

      // Move to next day.
      await time.increase(86400);

      // Clear yesterday's slot (now a past day).
      await vault.cleanupDailySpent(owner.address, [today]);
      expect(await vault.dailySpent(owner.address, today)).to.equal(0n);
    });

    it("reverts when trying to clear the current day", async () => {
      const { vault, owner } = await loadFixture(deployFixture);
      const today = Math.floor((await time.latest()) / 86400);
      await expect(
        vault.cleanupDailySpent(owner.address, [today])
      ).to.be.revertedWithCustomError(vault, "CannotClearCurrentOrFutureDay");
    });
  });
});
