/**
 * Register 3 canonical demo services on the ChainPeRegistry.
 *
 * Registers Weather Oracle, Price Feed, and Summarizer AI — the services used
 * in the grant demo video and e2e tests. Safe to run on Arbitrum Sepolia or mainnet.
 * Each service is idempotent: if the (developer, name) pair already exists the
 * script skips it rather than reverting.
 *
 * Prerequisites:
 *   - DEPLOYER_PRIVATE_KEY must own enough USDC to pay registrationFee × 3
 *   - DEPLOYER_PRIVATE_KEY must be approved to spend `registrationFee` on the feeToken
 *     (the script approves automatically if needed)
 *
 * Usage:
 *   npx hardhat run scripts/register-demo-services.ts --network arbitrumSepolia
 *   npx hardhat run scripts/register-demo-services.ts --network arbitrum
 */
import { ethers, network } from "hardhat";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const DEMO_SERVICES = [
  {
    name: "Weather Oracle",
    description:
      "Real-time weather and 7-day forecast for any city. Returns temperature, humidity, wind speed, and precipitation. Powered by open weather data.",
    tags: "weather,forecast,oracle,data",
    endpoint: "https://weather.chainpe.app",
    pricePerRequest: "0.01",
    paymentToken: "USDC",
    networkName: "arbitrum",
    payTo: "" as string, // filled at runtime from deployer
    agentId: 0n,
  },
  {
    name: "Price Feed",
    description:
      "On-demand price feeds for 100+ crypto assets and FX pairs. Sub-second latency, signed responses, backed by aggregated DEX + CEX data.",
    tags: "price,feed,oracle,defi,crypto",
    endpoint: "https://prices.chainpe.app",
    pricePerRequest: "0.005",
    paymentToken: "USDC",
    networkName: "arbitrum",
    payTo: "" as string,
    agentId: 0n,
  },
  {
    name: "Summarizer AI",
    description:
      "Condense any text or URL into a structured summary. Supports English, Spanish, French, and German. Returns title, bullet points, and sentiment.",
    tags: "ai,summarizer,nlp,text,llm",
    endpoint: "https://summarize.chainpe.app",
    pricePerRequest: "0.02",
    paymentToken: "USDC",
    networkName: "arbitrum",
    payTo: "" as string,
    agentId: 0n,
  },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log(`\nRegistering demo services on ${network.name} (chainId ${net.chainId})`);
  console.log(`  Deployer: ${deployer.address}\n`);

  // Resolve ChainPeRegistry address from deployments file.
  const deploymentsDir = join(__dirname, "..", "deployments");
  const registryFile = join(deploymentsDir, `${network.name}.json`);
  if (!existsSync(registryFile)) {
    throw new Error(
      `No deployment found at ${registryFile}. Deploy the registry first:\n  npm run deploy:${network.name === "arbitrum" ? "mainnet" : "sepolia"}`
    );
  }
  const d = JSON.parse(readFileSync(registryFile, "utf-8"));
  const registryAddr: string = d.chainPeRegistryProxy ?? d.chainPeRegistry;
  if (!registryAddr) throw new Error("Could not find chainPeRegistry address in deployment file.");

  console.log(`  Registry: ${registryAddr}`);

  const registry = await ethers.getContractAt("ChainPeRegistry", registryAddr);

  // Read fee token and registration fee.
  const feeTokenAddr: string = await (registry as unknown as { feeToken(): Promise<string> }).feeToken();
  const registrationFee: bigint = await (registry as unknown as { registrationFee(): Promise<bigint> }).registrationFee();
  console.log(`  Fee token:        ${feeTokenAddr}`);
  console.log(`  Registration fee: ${ethers.formatUnits(registrationFee, 6)} USDC\n`);

  // Approve feeToken for 3 × registrationFee if needed.
  if (registrationFee > 0n) {
    const token = await ethers.getContractAt(
      ["function allowance(address,address) view returns (uint256)",
       "function approve(address,uint256) returns (bool)"],
      feeTokenAddr
    );
    const allowance: bigint = await (token as unknown as { allowance(a: string, b: string): Promise<bigint> })
      .allowance(deployer.address, registryAddr);
    const needed = registrationFee * BigInt(DEMO_SERVICES.length);
    if (allowance < needed) {
      console.log("  Approving fee token...");
      const tx = await (token as unknown as { approve(a: string, b: bigint): Promise<{ wait(): Promise<unknown> }> })
        .approve(registryAddr, needed);
      await tx.wait();
      console.log("  Approved.\n");
    }
  }

  // Fill in the deployer as payTo (demo services; replace with real payout addresses post-launch).
  for (const svc of DEMO_SERVICES) {
    svc.payTo = deployer.address;
    // ChainPe network ids, as read by the SDK / wallet / agent.
    svc.networkName = network.name === "arbitrum" ? "arbitrum" : "arbitrum-sepolia";
  }

  let registered = 0;
  let skipped = 0;

  for (const svc of DEMO_SERVICES) {
    const hasService: boolean = await (registry as unknown as {
      hasService(dev: string, name: string): Promise<boolean>
    }).hasService(deployer.address, svc.name);

    if (hasService) {
      console.log(`  ⏭  ${svc.name} — already registered, skipping.`);
      skipped++;
      continue;
    }

    console.log(`  Registering "${svc.name}"...`);
    const tx = await (registry as unknown as {
      register(input: typeof svc): Promise<{ hash: string; wait(): Promise<unknown> }>
    }).register(svc);
    await tx.wait();
    console.log(`  ✓ ${svc.name} registered. tx: ${tx.hash}`);
    registered++;
  }

  console.log(`\n  Done — ${registered} registered, ${skipped} already existed.`);
  console.log(`  View on dashboard or query: curl <indexer>/services | jq\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
