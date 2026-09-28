#!/usr/bin/env node

/**
 * ChainPe CLI
 * Terminal interface for the x402 payment gateway on Arbitrum.
 */

import { program } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import gradient from "gradient-string";
import ora from "ora";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { privateKeyToAccount } from "viem/accounts";

import type { ChainPeConfig, ChainPeNetwork, DiscoveryConfig, FacilitatorSpec, PaymentToken } from "./types.js";
import { getNetworkConfig } from "@chainpe/sdk";
import { resolveFacilitatorSpecs } from "./proxy/facilitators.js";
import { discoveryFromSchema } from "./proxy/discovery.js";
import { isValidAddress, getAccountBalances, formatUsdc, formatEth } from "./evm.js";
import { resolveIdentityRegistry, mintAgentIdentity, hasIdentity } from "./erc8004.js";
import { explorerTxUrl, isChainPeNetwork, SUPPORTED_NETWORKS } from "./chains.js";
import { startProxyServer } from "./proxy/index.js";
import { setLogLevel } from "./logger.js";
import { ChainPeRegistryClient } from "./registry.js";
import { registerViaBrowser } from "./wallet-connect-browser.js";
import { runFetchCommand, runDiscoverCommand } from "./commands/consume.js";

// ============================================================================
// Constants
// ============================================================================

const CONFIG_DIR = path.join(os.homedir(), ".chainpe");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const VERSION = "2.0.0";

const chainpeGradient = gradient(["#12AAFF", "#4EC3FF", "#9DCCED"]); // Arbitrum blues

// ============================================================================
// Banner & styling
// ============================================================================

function printBanner(): void {
  console.log();
  console.log(
    chainpeGradient.multiline(`
   _____ _           _       _____
  / ____| |         (_)     |  __ \\
 | |    | |__   __ _ _ _ __ | |__) |___
 | |    | '_ \\ / _\` | | '_ \\|  ___/ _ \\
 | |____| | | | (_| | | | | | |  |  __/
  \\_____|_| |_|\\__,_|_|_| |_|_|   \\___|
`)
  );
  console.log(chalk.gray("  API Marketplace on Arbitrum • x402 Micropayments"));
  console.log();
}

function printSection(title: string): void {
  console.log();
  console.log(chalk.cyan.bold(`▸ ${title}`));
  console.log(chalk.gray("─".repeat(50)));
}

// ============================================================================
// File operations
// ============================================================================

async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

async function loadConfig(): Promise<ChainPeConfig | null> {
  let config: ChainPeConfig;
  try {
    config = JSON.parse(await fs.readFile(CONFIG_FILE, "utf-8")) as ChainPeConfig;
  } catch {
    return null;
  }
  if (config.paymentToken && isChainPeNetwork(config.network) && !getNetworkConfig(config.network).tokens[config.paymentToken]) {
    throw new Error(
      `${CONFIG_FILE}: ${config.paymentToken} is not available on ${config.network}. Run \`chainpe init\` to reconfigure.`
    );
  }
  if (!isChainPeNetwork(config.network)) {
    throw new Error(
      `${CONFIG_FILE} uses network "${config.network}", which is no longer supported ` +
        `(ChainPe now runs on ${SUPPORTED_NETWORKS.join(" / ")}). Run \`chainpe init\` to reconfigure.`
    );
  }
  return config;
}

async function saveConfig(config: ChainPeConfig): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ============================================================================
// Validation
// ============================================================================

function validateUrl(value: string | undefined): string | undefined {
  if (!value) return "URL is required";
  try {
    new URL(value);
    return undefined;
  } catch {
    return "Please enter a valid URL (e.g., http://localhost:3000)";
  }
}

function validatePrice(value: string | undefined): string | undefined {
  if (!value) return "Price is required";
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) return "Please enter a valid positive number";
  return undefined;
}

function validatePort(value: string | undefined): string | undefined {
  if (!value) return "Port is required";
  const port = parseInt(value, 10);
  if (isNaN(port) || port < 1 || port > 65535) return "Please enter a valid port (1-65535)";
  return undefined;
}

function validateWalletAddress(value: string | undefined): string | undefined {
  if (!value) return "Wallet address is required";
  if (!isValidAddress(value)) return "Please enter a valid EVM address (0x + 40 hex)";
  return undefined;
}

function validatePrivateKey(value: string | undefined): string | undefined {
  if (!value) return "Private key is required";
  try {
    privateKeyToAccount((value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`);
    return undefined;
  } catch {
    return "Invalid private key (expected 0x + 64 hex characters)";
  }
}

// ============================================================================
// init
// ============================================================================

async function runInit(): Promise<void> {
  printBanner();
  p.intro(chalk.bgRed.white(" ChainPe Setup "));

  const existing = await loadConfig();
  if (existing) {
    const overwrite = await p.confirm({ message: "Configuration already exists. Overwrite?", initialValue: false });
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }
  }

  printSection("Service Configuration");

  const targetUrl = await prompt(p.text({ message: "Your API URL (the backend ChainPe will proxy)", placeholder: "http://localhost:3000", validate: validateUrl }));
  const serviceName = await prompt(p.text({ message: "Service name (for registry listing)", placeholder: "My AI Agent API", validate: (v) => (!v || v.length < 3 ? "Name must be at least 3 characters" : undefined) }));
  const serviceDescription = await prompt(p.text({ message: "Service description", placeholder: "AI-powered research assistant", validate: (v) => (!v || v.length < 10 ? "Description must be at least 10 characters" : undefined) }));
  const tags = await prompt(p.text({ message: "Tags (comma-separated, for discovery)", placeholder: "ai, research, documents" }));

  printSection("Network & Wallet");
  const network = (await prompt(
    p.select({
      message: "Arbitrum network",
      options: [
        { value: "arbitrum-sepolia", label: "Arbitrum Sepolia (testnet)", hint: "recommended for testing" },
        { value: "arbitrum", label: "Arbitrum One (mainnet)" },
      ],
    })
  )) as ChainPeNetwork;

  printSection("Pricing");
  const tokenOptions = (Object.keys(getNetworkConfig(network).tokens) as PaymentToken[]).map((t) => ({
    value: t,
    label: t,
    hint: t === "USDC" ? "Circle USDC (default)" : "Tether USDT0",
  }));
  const paymentToken = (tokenOptions.length > 1
    ? await prompt(p.select({ message: "Payment token", options: tokenOptions }))
    : "USDC") as PaymentToken;
  const pricePerRequest = await prompt(p.text({ message: `Price per request (${paymentToken})`, placeholder: "0.01", validate: validatePrice }));

  console.log(chalk.gray("\n  Your wallet address receives all payments. No private key is needed to run the proxy.\n"));
  const walletAddress = (await prompt(p.text({ message: "Your EVM wallet address (0x…, receives payments on Arbitrum)", placeholder: "0x…", validate: validateWalletAddress }))) as string;

  const spinner = ora("Validating wallet address…").start();
  try {
    const balances = await getAccountBalances(network, walletAddress);
    spinner.succeed(`Wallet verified! Balance: ${chalk.green(formatEth(balances.eth))} ETH · ${chalk.green(formatUsdc(balances.usdc))} USDC`);
  } catch {
    spinner.succeed(`Wallet address accepted: ${shortAddr(walletAddress)}`);
  }

  printSection("Server Configuration");
  const proxyPort = await prompt(p.text({ message: "Proxy port", placeholder: "4402", initialValue: "4402", validate: validatePort }));
  const facilitatorChoice = (await prompt(
    p.select({
      message: "x402 facilitator (verifies + settles payments)",
      options: [
        {
          value: "default",
          label: "Recommended",
          hint:
            network === "arbitrum"
              ? "Coinbase CDP → PayAI fallback (CDP needs CDP_API_KEY_ID / CDP_API_KEY_SECRET)"
              : "PayAI (CDP has no Arbitrum Sepolia)",
        },
        { value: "payai", label: "PayAI only", hint: "free tier, no API key" },
        { value: "url", label: "Custom URL", hint: "e.g. your own services/chainpe-facilitator" },
      ],
    })
  )) as "default" | "payai" | "url";

  let facilitators: FacilitatorSpec[] | undefined;
  if (facilitatorChoice === "payai") {
    facilitators = [{ kind: "payai" }];
  } else if (facilitatorChoice === "url") {
    const url = (await prompt(
      p.text({ message: "Facilitator URL", placeholder: "https://facilitator.example.com", validate: validateUrl })
    )) as string;
    facilitators = [{ kind: "url", url }];
  }

  const discovery = await promptDiscovery(network, targetUrl as string);

  const config: ChainPeConfig = {
    serviceName: serviceName as string,
    serviceDescription: serviceDescription as string,
    tags: (tags as string).split(",").map((t) => t.trim()).filter(Boolean),
    targetUrl: targetUrl as string,
    pricePerRequest: pricePerRequest as string,
    paymentToken,
    walletAddress: walletAddress,
    proxyPort: parseInt(proxyPort as string, 10),
    network,
    facilitators,
    facilitatorUrl: facilitators ? undefined : process.env.CHAINPE_FACILITATOR_URL || undefined,
    registryAddress: process.env.CHAINPE_REGISTRY_ADDRESS,
    discovery,
    logLevel: "normal",
  };

  const s2 = ora("Saving configuration…").start();
  try {
    await saveConfig(config);
    s2.succeed("Configuration saved!");
  } catch {
    s2.fail("Failed to save configuration");
    process.exit(1);
  }

  console.log();
  console.log(chalk.green.bold("✓ Configuration complete!"));
  console.log(chalk.gray(`    Target:   ${chalk.white(config.targetUrl)}`));
  console.log(chalk.gray(`    Price:    ${chalk.green(config.pricePerRequest)} USDC per request`));
  console.log(chalk.gray(`    Payments: ${shortAddr(config.walletAddress)} on ${chalk.yellow(config.network)}`));
  console.log();
  console.log(chalk.gray(`  Register on-chain:  ${chalk.cyan("chainpe register")}`));
  console.log(chalk.gray(`  Start the gateway:  ${chalk.cyan("chainpe start")}`));
  console.log();
  p.outro(chalk.green("Setup complete! 🚀"));
}

/**
 * Asks whether to declare x402 Bazaar metadata, and offers to read the
 * request/response schema from the backend's `/schema` route.
 */
async function promptDiscovery(network: ChainPeNetwork, targetUrl: string): Promise<DiscoveryConfig> {
  printSection("Discovery");
  const enabled = await prompt(
    p.confirm({
      message: "List this API in Coinbase's x402 Bazaar?",
      initialValue: network === "arbitrum",
    })
  );
  if (!enabled) return { enabled: false };
  if (network !== "arbitrum") {
    console.log(chalk.gray("  Note: CDP lists Arbitrum One resources only; testnet offers are declared but not listed."));
  }

  const useSchema = await prompt(
    p.confirm({ message: `Read the request/response schema from ${targetUrl}/schema?`, initialValue: true })
  );
  if (!useSchema) return { enabled: true };

  const spinner = ora(`Fetching ${targetUrl}/schema…`).start();
  try {
    const res = await fetch(`${targetUrl.replace(/\/$/, "")}/schema`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const found = discoveryFromSchema(await res.json());
    const fields = Object.keys(found);
    if (fields.length === 0) {
      spinner.warn("No discovery fields found in /schema — declaring name, description and tags only.");
    } else {
      spinner.succeed(`Read from /schema: ${fields.join(", ")}`);
    }
    return { enabled: true, ...found };
  } catch (err) {
    spinner.warn(`Could not read /schema (${(err as Error).message}) — declaring name, description and tags only.`);
    return { enabled: true };
  }
}

// ============================================================================
// start
// ============================================================================

async function runStart(options: {
  port?: string;
  verbose?: boolean;
  facilitator?: string;
  facilitatorUrl?: string;
}): Promise<void> {
  printBanner();
  const config = await loadConfig();
  if (!config) {
    console.log(chalk.red("✗ No configuration found."));
    console.log(chalk.gray(`  Run ${chalk.cyan("chainpe init")} first.`));
    process.exit(1);
  }

  if (options.port) config.proxyPort = parseInt(options.port, 10);
  setLogLevel(options.verbose ? "verbose" : config.logLevel ?? "normal");

  const facilitatorKey = options.facilitator ?? process.env.CHAINPE_FACILITATOR_KEY;
  if (options.facilitatorUrl) {
    config.facilitators = [{ kind: "url", url: options.facilitatorUrl }];
  }
  const facilitatorLabel = facilitatorKey
    ? "in-process (local)"
    : resolveFacilitatorSpecs(config)
        .map((f) => (f.kind === "url" ? f.url : f.kind === "cdp" ? "CDP" : "PayAI"))
        .join(" → ");

  console.log(chalk.gray("  Starting x402 payment gateway…\n"));
  console.log(chalk.gray("  Configuration:"));
  console.log(chalk.gray(`    Service:  ${chalk.white(config.serviceName)}`));
  console.log(chalk.gray(`    Target:   ${chalk.white(config.targetUrl)}`));
  console.log(chalk.gray(`    Price:    ${chalk.green(config.pricePerRequest)} USDC`));
  console.log(chalk.gray(`    Wallet:   ${shortAddr(config.walletAddress)}`));
  console.log(chalk.gray(`    Network:  ${chalk.yellow(config.network)}`));
  console.log(chalk.gray(`    Facilitator: ${chalk.green(facilitatorLabel)}`));
  console.log();

  try {
    await startProxyServer({ config, facilitatorKey });
    console.log(chalk.gray("  Press Ctrl+C to stop\n"));
    process.on("SIGINT", () => {
      console.log(chalk.yellow("\n  Shutting down…"));
      process.exit(0);
    });
  } catch (error) {
    console.log(chalk.red(`✗ Failed to start server: ${(error as Error).message}`));
    process.exit(1);
  }
}

// ============================================================================
// register
// ============================================================================

async function runRegister(): Promise<void> {
  printBanner();
  const config = await loadConfig();
  if (!config) {
    console.log(chalk.red("✗ No configuration found."));
    console.log(chalk.gray(`  Run ${chalk.cyan("chainpe init")} first.`));
    process.exit(1);
  }

  p.intro(chalk.bgRed.white(" Register Service On-Chain "));

  let registryClient: ChainPeRegistryClient;
  try {
    registryClient = new ChainPeRegistryClient(config.network, config.registryAddress);
  } catch (e) {
    console.log(chalk.red(`✗ ${(e as Error).message}`));
    console.log(chalk.gray("  Set registryAddress in ~/.chainpe/config.json or CHAINPE_REGISTRY_ADDRESS."));
    process.exit(1);
  }

  const endpoint = (await prompt(p.text({ message: "Public endpoint URL (where clients connect)", placeholder: `http://localhost:${config.proxyPort}`, initialValue: `http://localhost:${config.proxyPort}`, validate: validateUrl }))) as string;

  const alreadyExists = await registryClient.hasService(config.walletAddress, config.serviceName);
  const isUpdate = alreadyExists;

  console.log();
  console.log(chalk.gray(`  Service to ${isUpdate ? "update" : "register"}:`));
  console.log(chalk.gray(`    Name:     ${chalk.white(config.serviceName)}`));
  console.log(chalk.gray(`    Price:    ${chalk.green(config.pricePerRequest)} USDC`));
  console.log(chalk.gray(`    Endpoint: ${chalk.cyan(endpoint)}`));
  console.log(chalk.gray(`    Wallet:   ${shortAddr(config.walletAddress)}`));
  if (isUpdate) console.log(chalk.yellow("  ℹ Service already registered — will call update() on-chain."));
  try {
    const fee = await registryClient.registrationFee();
    console.log(chalk.gray(`    Fee:      ${chalk.green(formatUsdc(fee))} USDC (requires approval)`));
  } catch {
    /* ignore */
  }
  console.log();

  const signMethod = await prompt(
    p.select({
      message: "How would you like to sign the registration transaction?",
      options: [
        { value: "browser", label: "Browser wallet (MetaMask / Rabby)", hint: "recommended — confirm in your browser" },
        { value: "key", label: "Paste private key", hint: "signs directly in the terminal (auto-mints ERC-8004 identity)" },
      ],
    })
  );

  if (signMethod === "browser") {
    // Browser flow: reuse an existing agentId from config if available (can't auto-mint in browser).
    const agentId = config.agentId ?? "0";
    if (agentId !== "0") {
      console.log(chalk.gray(`  ℹ Linking to existing ERC-8004 identity #${agentId} (from saved config).`));
    } else {
      console.log(chalk.yellow("  ℹ No ERC-8004 identity set. Service will register without reputation."));
      console.log(chalk.gray("    Run `chainpe register` with a private key to auto-mint one."));
    }
    console.log();
    console.log(
      chalk.gray(
        `  A browser window will open. Connect ${shortAddr(config.walletAddress)} and confirm the transaction(s).`
      )
    );
    const result = await registerViaBrowser({
      registryAddress: registryClient.getContractInfo().address,
      network: config.network,
      walletAddress: config.walletAddress,
      name: config.serviceName,
      description: config.serviceDescription,
      tags: config.tags,
      endpoint,
      pricePerRequest: config.pricePerRequest,
      paymentToken: config.paymentToken,
      agentId,
      isUpdate,
    });
    if (result.success && result.txnHash) {
      console.log();
      console.log(chalk.green(`  ✓ ${isUpdate ? "Service updated" : "Service registered"} on-chain!`));
      console.log(chalk.gray(`    Tx: ${chalk.cyan(result.txnHash)}`));
      console.log(chalk.gray(`    Explorer: ${chalk.cyan(explorerTxUrl(config.network, result.txnHash))}`));
      console.log();
      p.outro(chalk.green("Service is now discoverable on Arbitrum!"));
    } else {
      console.log(chalk.red(`  ✗ ${result.error || "Registration was not completed in the browser"}`));
      process.exit(1);
    }
    return;
  }

  // Private key flow: auto-mint an ERC-8004 identity if the wallet doesn't have one yet.
  const privateKey = (await prompt(
    p.password({ message: "Enter your wallet private key (0x…, signs the transaction)", validate: validatePrivateKey })
  )) as string;

  // ── ERC-8004 identity ────────────────────────────────────────────────────
  let agentId = config.agentId ?? "0";
  const identityRegistry = resolveIdentityRegistry(config.network, process.env.ERC8004_IDENTITY_REGISTRY);

  if (agentId !== "0") {
    console.log(chalk.gray(`  ℹ Reusing existing ERC-8004 identity #${agentId}.`));
  } else if (identityRegistry) {
    // Check whether this wallet already has an identity (e.g. minted on another machine).
    const alreadyHasId = await hasIdentity({
      network: config.network,
      identityRegistry,
      ownerAddress: config.walletAddress,
    });
    if (alreadyHasId) {
      console.log(chalk.yellow("  ℹ Wallet already has an ERC-8004 identity. Pass --agent-id <n> to link it, or re-run after noting the id."));
    } else {
      const mintSpinner = ora("Minting ERC-8004 reputation identity…").start();
      try {
        const { agentId: newId, txHash } = await mintAgentIdentity({
          network: config.network,
          privateKey,
          identityRegistry,
        });
        agentId = newId;
        config.agentId = newId;
        await saveConfig(config).catch(() => {});
        mintSpinner.succeed(`ERC-8004 identity minted! Agent #${newId}`);
        console.log(chalk.gray(`    Tx: ${chalk.cyan(explorerTxUrl(config.network, txHash))}`));
      } catch (err) {
        mintSpinner.warn(`Could not mint ERC-8004 identity: ${(err as Error).message}`);
        console.log(chalk.gray("    Registering without reputation. You can mint manually with mint-identity.mjs."));
      }
    }
  } else {
    console.log(chalk.gray("  ERC8004_IDENTITY_REGISTRY not set — skipping identity mint."));
  }
  // ────────────────────────────────────────────────────────────────────────

  const spinner = ora(isUpdate ? "Updating service on-chain…" : "Registering service on-chain…").start();
  try {
    const result = await registryClient.registerService({
      privateKey,
      isUpdate,
      name: config.serviceName,
      description: config.serviceDescription,
      tags: config.tags,
      endpoint,
      pricePerRequest: config.pricePerRequest,
      paymentToken: config.paymentToken,
      walletAddress: config.walletAddress,
      network: config.network,
      agentId,
    });
    // Persist agentId to config so subsequent runs skip the mint.
    if (agentId !== "0" && config.agentId !== agentId) {
      config.agentId = agentId;
      await saveConfig(config).catch(() => {});
    }
    spinner.succeed(isUpdate ? "Service updated on-chain!" : "Service registered on-chain!");
    console.log(chalk.gray(`    Tx: ${chalk.cyan(result.txnHash)}`));
    console.log(chalk.gray(`    Explorer: ${chalk.cyan(explorerTxUrl(config.network, result.txnHash))}`));
    if (agentId !== "0") {
      console.log(chalk.gray(`    ERC-8004 agent #${agentId} linked — reputation will accrue per paid call.`));
    }
    console.log();
    p.outro(chalk.green("Service is now discoverable on Arbitrum!"));
  } catch (error) {
    spinner.fail(isUpdate ? "Update failed" : "Registration failed");
    console.log(chalk.red(`  ✗ ${(error as Error).message}`));
    process.exit(1);
  }
}

// ============================================================================
// deregister
// ============================================================================

async function runDeregister(): Promise<void> {
  printBanner();
  const config = await loadConfig();
  if (!config) {
    console.log(chalk.red("✗ No configuration found."));
    process.exit(1);
  }
  p.intro(chalk.bgRed.white(" Deregister Service "));

  const registryClient = new ChainPeRegistryClient(config.network, config.registryAddress);
  const privateKey = (await prompt(p.password({ message: "Enter your wallet private key (signs the transaction)", validate: validatePrivateKey }))) as string;

  const spinner = ora("Removing service from the registry…").start();
  try {
    const result = await registryClient.deregisterService(privateKey, config.serviceName);
    spinner.succeed("Service deregistered.");
    console.log(chalk.gray(`    Tx: ${chalk.cyan(explorerTxUrl(config.network, result.txnHash))}`));
    p.outro(chalk.green("Done."));
  } catch (error) {
    spinner.fail("Deregistration failed");
    console.log(chalk.red(`  ✗ ${(error as Error).message}`));
    process.exit(1);
  }
}

// ============================================================================
// list
// ============================================================================

async function runList(): Promise<void> {
  printBanner();
  console.log(chalk.cyan.bold("▸ Registered Services (Arbitrum)"));
  console.log(chalk.gray("─".repeat(50)));
  console.log();

  const config = await loadConfig();
  if (!config) {
    console.log(chalk.gray("  Run chainpe init first.\n"));
    return;
  }

  const spinner = ora("Fetching services from the on-chain registry…").start();
  try {
    const registryClient = new ChainPeRegistryClient(config.network, config.registryAddress);
    const services = await registryClient.listServices();
    spinner.stop();

    if (services.length === 0) {
      console.log(chalk.gray("  No services registered on-chain yet."));
      console.log(chalk.gray(`  Run ${chalk.cyan("chainpe register")} to publish your service.\n`));
      return;
    }

    for (const svc of services) {
      console.log(chalk.white.bold(`  ${svc.name}`));
      console.log(chalk.gray(`    ${svc.description}`));
      console.log(chalk.gray(`    Endpoint:  ${chalk.cyan(svc.endpoint)}`));
      console.log(chalk.gray(`    Price:     ${chalk.green(svc.pricePerRequest)} ${svc.paymentToken}`));
      console.log(chalk.gray(`    Tags:      ${svc.tags.join(", ")}`));
      console.log(chalk.gray(`    Developer: ${shortAddr(svc.developer)}`));
      if (svc.agentId !== "0") console.log(chalk.gray(`    Agent ID:  ${svc.agentId} (ERC-8004)`));
      console.log();
    }
    const { address } = registryClient.getContractInfo();
    console.log(chalk.gray(`  Total: ${services.length} service(s) · Registry ${address}\n`));
  } catch (error) {
    spinner.fail("Failed to fetch from the on-chain registry");
    console.log(chalk.red(`  ${(error as Error).message}\n`));
  }
}

// ============================================================================
// status
// ============================================================================

async function runStatus(): Promise<void> {
  printBanner();
  const config = await loadConfig();
  console.log(chalk.cyan.bold("▸ ChainPe Status"));
  console.log(chalk.gray("─".repeat(50)));
  console.log();

  if (!config) {
    console.log(chalk.yellow("  ⚠ Not configured"));
    console.log(chalk.gray(`    Run ${chalk.cyan("chainpe init")} to get started.\n`));
    return;
  }

  console.log(chalk.gray("  Configuration:"));
  console.log(chalk.gray(`    Service:     ${chalk.white(config.serviceName)}`));
  console.log(chalk.gray(`    Target:      ${chalk.white(config.targetUrl)}`));
  console.log(chalk.gray(`    Price:       ${chalk.green(config.pricePerRequest)} USDC`));
  console.log(chalk.gray(`    Network:     ${chalk.yellow(config.network)}`));
  console.log();
  console.log(chalk.gray("  Wallet (receives payments):"));
  console.log(chalk.gray(`    Address:     ${chalk.cyan(config.walletAddress)}`));

  const spinner = ora("Checking balance…").start();
  try {
    const balances = await getAccountBalances(config.network, config.walletAddress);
    spinner.stop();
    console.log(chalk.gray(`    Balance:     ${chalk.green(formatEth(balances.eth))} ETH`));
    console.log(chalk.gray(`                 ${chalk.green(formatUsdc(balances.usdc))} USDC`));
  } catch {
    spinner.stop();
    console.log(chalk.gray(`    Balance:     ${chalk.yellow("(could not fetch)")}`));
  }
  console.log();

  console.log(chalk.gray("  Registry:"));
  if (!config.registryAddress && !process.env.CHAINPE_REGISTRY_ADDRESS) {
    console.log(chalk.gray(`    ${chalk.yellow("not set")} — deploy the contract and set registryAddress.`));
    console.log();
    return;
  }
  const registryClient = new ChainPeRegistryClient(config.network, config.registryAddress);
  console.log(chalk.gray(`    Contract:    ${chalk.white(registryClient.getContractInfo().address)}`));
  const s2 = ora("Checking on-chain registration…").start();
  try {
    const isRegistered = await registryClient.hasService(config.walletAddress, config.serviceName);
    s2.stop();
    console.log(chalk.gray(`    Status:      ${isRegistered ? chalk.green("✓ registered") : chalk.yellow("○ not registered")}`));
  } catch {
    s2.stop();
    console.log(chalk.gray(`    Status:      ${chalk.yellow("(could not check)")}`));
  }
  console.log();
}

// ============================================================================
// helpers
// ============================================================================

async function prompt<T>(thenable: Promise<T | symbol>): Promise<T> {
  const value = await thenable;
  if (p.isCancel(value)) {
    p.cancel("Cancelled");
    process.exit(0);
  }
  return value as T;
}

function shortAddr(addr: string): string {
  return `${chalk.cyan(addr.slice(0, 6))}…${chalk.cyan(addr.slice(-4))}`;
}

// ============================================================================
// Main
// ============================================================================

program
  .name("chainpe")
  .description("ChainPe — Monetize any API with x402 micropayments on Arbitrum")
  .version(VERSION);

program.command("init").description("Initialize a new ChainPe configuration").action(runInit);
program
  .command("start")
  .description("Start the x402 payment proxy")
  .option("-p, --port <port>", "Override the proxy port")
  .option("-v, --verbose", "Enable verbose logging")
  .option("-f, --facilitator <privateKey>", "EVM key to run an in-process facilitator (settles on-chain)")
  .option("--facilitator-url <url>", "Use this x402 facilitator instead of the configured ones")
  .action(runStart);
program.command("register").description("Register / update your service on-chain").action(runRegister);
program.command("deregister").description("Remove your service from the on-chain registry").action(runDeregister);
program.command("list").description("List all services registered on-chain").action(runList);
program.command("status").description("Show current configuration and status").action(runStatus);

program
  .command("fetch <url>")
  .description("Fetch a URL as a consumer, auto-paying any x402 402 in USDC (curl-level)")
  .option("-X, --method <method>", "HTTP method (default GET)")
  .option("-H, --header <header...>", "Request header as \"Key: Value\" (repeatable)")
  .option("-d, --data <body>", "Request body")
  .option("-k, --key <privateKey>", "Consumer wallet key (default: $CHAINPE_PRIVATE_KEY)")
  .option("-n, --network <network>", "arbitrum | arbitrum-sepolia (default: $CHAINPE_NETWORK or arbitrum)")
  .option("--max <usdc>", "Max USDC to auto-pay for one call (default 1)")
  .option("--feedback", "Post positive ERC-8004 reputation after a paid call")
  .option("--raw", "Print only the response body (for piping)")
  .action(runFetchCommand);

program
  .command("discover [query]")
  .description("Discover on-chain services ranked by ERC-8004 reputation")
  .option("-n, --network <network>", "arbitrum | arbitrum-sepolia (default: $CHAINPE_NETWORK or arbitrum)")
  .option("--tag <tag...>", "Filter by tag (repeatable)")
  .option("--max-price <usdc>", "Maximum price per request in USDC")
  .option("--json", "Output raw JSON")
  .action(runDiscoverCommand);

program.parse();
