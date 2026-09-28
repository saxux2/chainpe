import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

// Load .env from the contracts workspace and the repo root (root takes lower priority).
dotenv.config();
dotenv.config({ path: "../.env" });

// ============================================================================
// Secrets (NEVER hardcode — read from environment / gitignored .env)
// ============================================================================
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";
// Etherscan V2 API key — one key verifies on Arbiscan (Arbitrum One + Sepolia).
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? "";

const ARBITRUM_SEPOLIA_RPC_URL =
  process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
const ARBITRUM_RPC_URL =
  process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc";

// Only attach an account if a key is present, so `hardhat compile`/`test`
// work without any secrets configured.
const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

// When MAINNET_FORK=true, the default hardhat network forks Arbitrum One.
const MAINNET_FORK = process.env.MAINNET_FORK === "true";
const FORK_BLOCK = process.env.FORK_BLOCK ? parseInt(process.env.FORK_BLOCK, 10) : undefined;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 1000 },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      // HARDHAT_CHAIN_ID lets e2e/local.test.mjs run a node that looks like
      // Arbitrum Sepolia (421614) to the SDK and the x402 client.
      chainId: MAINNET_FORK ? 42161 : Number(process.env.HARDHAT_CHAIN_ID || 31337),
      hardfork: "cancun",
      ...(MAINNET_FORK
        ? { forking: { url: ARBITRUM_RPC_URL, ...(FORK_BLOCK ? { blockNumber: FORK_BLOCK } : {}) } }
        : {}),
    },
    arbitrumSepolia: {
      url: ARBITRUM_SEPOLIA_RPC_URL,
      chainId: 421614,
      accounts,
    },
    arbitrum: {
      url: ARBITRUM_RPC_URL,
      chainId: 42161,
      accounts,
    },
  },
  // Arbiscan verification via the Etherscan V2 multichain API.
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
    customChains: [
      {
        network: "arbitrum",
        chainId: 42161,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=42161",
          browserURL: "https://arbiscan.io",
        },
      },
      {
        network: "arbitrumSepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=421614",
          browserURL: "https://sepolia.arbiscan.io",
        },
      },
    ],
  },
  sourcify: { enabled: false },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config;
