/**
 * Verify a previously deployed ChainPeRegistry on Arbiscan.
 *
 * Reads the constructor args from deployments/<network>.json and runs the
 * hardhat-verify plugin programmatically.
 *
 * Usage:
 *   npm run verify:sepolia
 */
import { run, network } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

async function main() {
  const file = join(__dirname, "..", "deployments", `${network.name}.json`);
  const d = JSON.parse(readFileSync(file, "utf-8"));

  console.log(`Verifying ChainPeRegistry at ${d.chainPeRegistry} on ${network.name}...`);
  await run("verify:verify", {
    address: d.chainPeRegistry,
    constructorArguments: [
      d.feeToken,
      d.feeRecipient,
      d.registrationFee,
      d.identityRegistry,
      d.deployer,
    ],
  });
  console.log("Verification submitted.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
