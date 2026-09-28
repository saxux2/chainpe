/**
 * Transfer ownership of deployed ChainPe contracts to a Gnosis Safe multisig.
 *
 * This script reads deployed contract addresses from the deployments/ folder
 * and calls transferOwnership (Ownable2Step) on each contract. The Safe must
 * then call acceptOwnership() to complete the two-step transfer.
 *
 * Usage:
 *   SAFE_ADDRESS=0xYourSafe... npx hardhat run scripts/transfer-ownership.ts --network arbitrum
 *
 * Env:
 *   SAFE_ADDRESS             (required) Gnosis Safe multisig address
 *   DEPLOYER_PRIVATE_KEY     funded key that currently owns the contracts
 *
 * After running this script, import the contracts into the Gnosis Safe UI
 * and call acceptOwnership() on each to complete the handover.
 */
import { ethers, network } from "hardhat";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

async function main() {
  const safeAddress = process.env.SAFE_ADDRESS;
  if (!safeAddress || safeAddress === "") {
    throw new Error("SAFE_ADDRESS env var is required. Set it to your Gnosis Safe address.");
  }
  if (!ethers.isAddress(safeAddress)) {
    throw new Error(`SAFE_ADDRESS "${safeAddress}" is not a valid Ethereum address.`);
  }

  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log(`\nTransferring ownership on ${network.name} (chainId ${net.chainId})`);
  console.log(`  Deployer (current owner): ${deployer.address}`);
  console.log(`  New owner (Gnosis Safe):  ${safeAddress}`);

  const dir = join(__dirname, "..", "deployments");
  const contracts: { name: string; address: string; abiName: string }[] = [];

  const registryFile = join(dir, `${network.name}.json`);
  if (existsSync(registryFile)) {
    const d = JSON.parse(readFileSync(registryFile, "utf-8"));
    const addr = d.chainPeRegistryProxy ?? d.chainPeRegistry;
    const abiName = d.upgradeable ? "ChainPeRegistryUpgradeable" : "ChainPeRegistry";
    if (addr) contracts.push({ name: "ChainPeRegistry", address: addr, abiName });
  }

  const vaultFile = join(dir, `${network.name}-policyvault.json`);
  if (existsSync(vaultFile)) {
    const d = JSON.parse(readFileSync(vaultFile, "utf-8"));
    const addr = d.policyVaultProxy ?? d.policyVault;
    const abiName = d.upgradeable ? "PolicyVaultUpgradeable" : "PolicyVault";
    if (addr) contracts.push({ name: "PolicyVault", address: addr, abiName });
  }

  if (contracts.length === 0) {
    console.log("\n  No deployed contracts found in deployments/. Nothing to transfer.");
    return;
  }

  console.log(`\n  Found ${contracts.length} contract(s):`);
  for (const c of contracts) {
    console.log(`    ${c.name}: ${c.address}`);
  }

  for (const c of contracts) {
    console.log(`\n  Transferring ${c.name}...`);
    const contract = await ethers.getContractAt(c.abiName, c.address);

    // Verify current owner.
    let currentOwner: string;
    try {
      currentOwner = await (contract as unknown as { owner(): Promise<string> }).owner();
    } catch {
      console.log(`    ⚠ Could not read owner — skipping ${c.name}.`);
      continue;
    }
    if (currentOwner.toLowerCase() !== deployer.address.toLowerCase()) {
      console.log(`    ⚠ Current owner is ${currentOwner}, not deployer. Skipping.`);
      continue;
    }

    const tx = await (contract as unknown as { transferOwnership(a: string): Promise<{ hash: string; wait(): Promise<unknown> }> })
      .transferOwnership(safeAddress);
    await tx.wait();
    console.log(`    ✓ transferOwnership tx: ${tx.hash}`);
    console.log(`    Pending owner: ${safeAddress}`);
  }

  console.log("\n========================================");
  console.log("  Ownership transfer initiated.");
  console.log("  The Gnosis Safe must now call acceptOwnership() on each contract.");
  console.log("  Use the Safe UI at https://app.safe.global to queue the transactions.");
  console.log("========================================\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
