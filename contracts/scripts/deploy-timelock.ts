/**
 * Deploy ChainPeTimelock (OpenZeppelin TimelockController) to own the
 * upgradeable ChainPe contracts. Routing UUPS upgrades + admin actions through
 * the timelock gives depositors a guaranteed delay window before any privileged
 * action takes effect.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-timelock.ts --network arbitrumSepolia
 *   npx hardhat run scripts/deploy-timelock.ts --network arbitrum
 *
 * Required env:
 *   DEPLOYER_PRIVATE_KEY   funded deployer key
 * Optional env:
 *   TIMELOCK_MIN_DELAY     delay in seconds (default 172800 = 48h)
 *   TIMELOCK_PROPOSERS     comma-separated addresses allowed to schedule actions
 *                          (default: deployer — ⚠ set this to your Gnosis Safe)
 *   TIMELOCK_EXECUTORS     comma-separated addresses allowed to execute after the
 *                          delay. Use the zero address to allow anyone to execute.
 *                          (default: same as proposers)
 *   TIMELOCK_ADMIN         optional admin that can reconfigure roles
 *                          (default: address(0) = self-governed, recommended)
 *
 * After this runs, deploy the registry/vault with OWNER_ADDRESS=<timelock>, or
 * transfer ownership of already-deployed contracts to the timelock.
 *
 * Writes the address to deployments/<network>-timelock.json.
 */
import { ethers, network } from "hardhat";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const DEFAULT_MIN_DELAY = 172_800; // 48 hours

function parseAddressList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
    .map((a) => ethers.getAddress(a));
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const minDelay = Number(process.env.TIMELOCK_MIN_DELAY || DEFAULT_MIN_DELAY);
  const proposers = parseAddressList(process.env.TIMELOCK_PROPOSERS, [deployer.address]);
  const executors = parseAddressList(process.env.TIMELOCK_EXECUTORS, proposers);
  const admin = process.env.TIMELOCK_ADMIN
    ? ethers.getAddress(process.env.TIMELOCK_ADMIN)
    : ethers.ZeroAddress;

  const proposersAreDeployer =
    proposers.length === 1 && proposers[0] === deployer.address;
  if (proposersAreDeployer && chainId === 42161) {
    console.warn(
      "\n⚠  WARNING: TIMELOCK_PROPOSERS is not set; the deployer EOA is the only\n" +
      "   proposer. On mainnet, set TIMELOCK_PROPOSERS to your Gnosis Safe so no\n" +
      "   single key controls scheduling.\n"
    );
  }

  console.log(`\nDeploying ChainPeTimelock to ${network.name} (chainId ${chainId})`);
  console.log(`  Deployer:   ${deployer.address}`);
  console.log(`  Min delay:  ${minDelay}s (${(minDelay / 3600).toFixed(1)}h)`);
  console.log(`  Proposers:  ${proposers.join(", ")}`);
  console.log(`  Executors:  ${executors.map((e) => (e === ethers.ZeroAddress ? "anyone" : e)).join(", ")}`);
  console.log(`  Admin:      ${admin === ethers.ZeroAddress ? "none (self-governed)" : admin}`);

  const Timelock = await ethers.getContractFactory("ChainPeTimelock");
  const timelock = await Timelock.deploy(minDelay, proposers, executors, admin);
  await timelock.waitForDeployment();
  const addr = await timelock.getAddress();

  console.log("\n========================================");
  console.log("  ChainPeTimelock deployed");
  console.log("========================================");
  console.log(`  Timelock: ${addr}`);
  console.log(`\n  Use this address as OWNER_ADDRESS when deploying the registry/vault:`);
  console.log(`    OWNER_ADDRESS=${addr} npx hardhat run scripts/deploy-policyvault.ts --network ${network.name}`);
  console.log(`\n  Verify with:`);
  console.log(`    npx hardhat verify --network ${network.name} ${addr} ${minDelay} '[${proposers.map((p) => `"${p}"`).join(",")}]' '[${executors.map((e) => `"${e}"`).join(",")}]' ${admin}`);

  const dir = join(__dirname, "..", "deployments");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const out = {
    network: network.name,
    chainId,
    timelock: addr,
    minDelay,
    proposers,
    executors,
    admin,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };
  writeFileSync(
    join(dir, `${network.name}-timelock.json`),
    JSON.stringify(out, null, 2) + "\n"
  );
  console.log(`\n  Saved -> deployments/${network.name}-timelock.json`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
