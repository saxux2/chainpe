/**
 * Post-deploy sanity check: reads live state from the deployed proxies listed
 * in deployments/<network>.json and deployments/<network>-policyvault.json.
 *
 * Usage:
 *   npx hardhat run scripts/postcheck.ts --network arbitrum
 */
import { ethers, network } from "hardhat";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const USDC: Record<number, string> = {
  421614: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};
const IDENTITY: Record<number, string> = {
  421614: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  42161: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
};

function readDeployment(file: string): Record<string, string> | undefined {
  const path = join(__dirname, "..", "deployments", file);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : undefined;
}

async function main() {
  const [signer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const usdc = USDC[chainId];
  const identity = IDENTITY[chainId];

  const core = readDeployment(`${network.name}.json`);
  const registryAddr = core?.chainPeRegistryProxy ?? core?.chainPeRegistry;
  if (registryAddr) {
    const reg = await ethers.getContractAt("ChainPeRegistryUpgradeable", registryAddr);
    console.log("\n  ── ChainPeRegistry ──", registryAddr);
    console.log("  owner:            ", await reg.owner());
    console.log("  feeToken:         ", await reg.feeToken(), (await reg.feeToken()) === usdc ? "(USDC ✓)" : "(✗)");
    console.log("  registrationFee:  ", (await reg.registrationFee()).toString());
    console.log("  identityRegistry: ", await reg.identityRegistry(), (await reg.identityRegistry()) === identity ? "✓" : "✗");
    console.log("  serviceCount:     ", (await reg.getServiceCount()).toString());
  } else {
    console.log(`\n  No ChainPeRegistry deployment found for ${network.name}.`);
  }

  const pv = readDeployment(`${network.name}-policyvault.json`);
  const vaultAddr = pv?.policyVaultProxy ?? pv?.policyVault;
  if (vaultAddr) {
    const vault = await ethers.getContractAt("PolicyVaultUpgradeable", vaultAddr);
    console.log("\n  ── PolicyVault ──", vaultAddr);
    console.log("  owner:            ", await vault.owner());
    console.log("  token:            ", await vault.token(), (await vault.token()) === usdc ? "(USDC ✓)" : "(✗)");
    console.log("  paused:           ", await vault.paused());
  } else {
    console.log(`\n  No PolicyVault deployment found for ${network.name}.`);
  }

  const bal = await ethers.provider.getBalance(signer.address);
  console.log("\n  Deployer balance now: ", ethers.formatEther(bal), "ETH");
}
main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
