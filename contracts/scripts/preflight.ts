/**
 * Mainnet preflight: prints the signer Hardhat will actually use, its balance,
 * the live gas price, and an estimated total deploy cost. Read-only — sends no tx.
 */
import { ethers, network } from "hardhat";

// Optional: set EXPECTED_DEPLOYER to fail fast if the env key is the wrong wallet.
const EXPECTED = process.env.EXPECTED_DEPLOYER;
const TOTAL_GAS_EST = 15_000_000n; // registry + policy vault + timelock, generous

async function main() {
  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const addr = await signer.getAddress();
  const bal = await ethers.provider.getBalance(addr);
  const fee = await ethers.provider.getFeeData();
  const gasPrice = fee.gasPrice ?? 0n;

  console.log(`\n  Network:        ${network.name} (chainId ${net.chainId})`);
  console.log(`  Signer (env):   ${addr}`);
  if (EXPECTED) {
    console.log(`  Expected:       ${EXPECTED}`);
    console.log(`  MATCH:          ${addr.toLowerCase() === EXPECTED.toLowerCase() ? "YES ✓" : "NO ✗ — env key is a DIFFERENT wallet!"}`);
  }
  console.log(`  Balance:        ${ethers.formatEther(bal)} ETH`);
  console.log(`  Gas price:      ${ethers.formatUnits(gasPrice, 9)} gwei`);
  // Rough: Arbitrum fees also include an L1 data component not shown here.
  const estCost = TOTAL_GAS_EST * gasPrice;
  console.log(`  Est. full deploy (~${TOTAL_GAS_EST} gas, L2 only): ${ethers.formatEther(estCost)} ETH`);
  console.log(`  Sufficient:     ${bal > estCost ? "YES ✓" : "NO ✗"}\n`);

  if (EXPECTED && addr.toLowerCase() !== EXPECTED.toLowerCase()) {
    throw new Error("Signer mismatch — refusing. Set DEPLOYER_PRIVATE_KEY to the funded key.");
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
