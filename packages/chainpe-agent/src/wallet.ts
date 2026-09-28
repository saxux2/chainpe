/**
 * Wallet Module (Arbitrum)
 *
 * Derives an EVM account from a private key and builds an x402 signer for
 * payments.
 *
 * SECURITY: Private keys are retrieved from the OS keychain, never stored in files.
 */

import {
  createPublicClient,
  http,
  erc20Abi,
  formatUnits,
  parseUnits,
  getAddress,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { chainFor } from "@chainpe/sdk";

import type { ChainPeNetwork } from "./types.js";
import { DEFAULT_AGENT_NETWORK, RPC_URLS, USDC_ADDRESS, USDC_DECIMALS } from "./types.js";
import { getPrivateKey } from "./keychain.js";

function normalizeKey(key: string): `0x${string}` {
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

// ============================================================================
// Wallet Creation
// ============================================================================

export interface WalletInstance {
  address: string;
  /** x402 EVM signer (viem local account) used to sign EIP-3009 authorizations. */
  signer: PrivateKeyAccount;
  network: ChainPeNetwork;
}

/** Creates a wallet instance from a private key for the given network. */
export async function createWalletFromPrivateKey(
  privateKey: string,
  network: ChainPeNetwork = DEFAULT_AGENT_NETWORK
): Promise<WalletInstance> {
  const account = privateKeyToAccount(normalizeKey(privateKey));
  return { address: account.address, signer: account, network };
}

/** Creates a wallet instance by retrieving the private key from the OS keychain. */
export async function createWalletFromAddress(
  address: string,
  network: ChainPeNetwork = DEFAULT_AGENT_NETWORK
): Promise<WalletInstance> {
  const privateKey = await getPrivateKey(address);
  if (!privateKey) {
    throw new Error(
      `Wallet private key not found in OS keychain for address: ${address}\n` +
        `Run 'chainpe-agent init' to set up your wallet.`
    );
  }
  return createWalletFromPrivateKey(privateKey, network);
}

/** Derives the EVM address from a private key. */
export function addressFromPrivateKey(privateKey: string): string {
  return privateKeyToAccount(normalizeKey(privateKey)).address;
}

// ============================================================================
// Clients
// ============================================================================

export function createClient(network: ChainPeNetwork): PublicClient {
  return createPublicClient({ chain: chainFor(network), transport: http(RPC_URLS[network]) });
}

// ============================================================================
// Balances
// ============================================================================

export interface WalletBalance {
  eth: bigint; // wei (18 decimals)
  usdc: bigint; // atomic (6 decimals)
}

export async function getWalletBalance(
  address: string,
  network: ChainPeNetwork
): Promise<WalletBalance> {
  const client = createClient(network);
  const addr = getAddress(address);
  try {
    const [eth, usdc] = await Promise.all([
      client.getBalance({ address: addr }),
      client.readContract({
        address: USDC_ADDRESS[network],
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [addr],
      }) as Promise<bigint>,
    ]);
    return { eth, usdc };
  } catch {
    return { eth: 0n, usdc: 0n };
  }
}

export function hasSufficientUsdc(balance: WalletBalance, amountAtomic: bigint): boolean {
  return balance.usdc >= amountAtomic;
}

// ============================================================================
// Formatting
// ============================================================================

/** Formats atomic USDC (6 decimals) to a human string. */
export function formatAmount(atomic: bigint, decimals: number = USDC_DECIMALS): string {
  return formatUnits(atomic, decimals);
}

/** Parses a human USDC string to atomic units. */
export function parseAmount(amount: string, decimals: number = USDC_DECIMALS): bigint {
  return parseUnits(amount, decimals);
}

export function formatBalance(balance: WalletBalance): { eth: string; usdc: string } {
  return {
    eth: formatUnits(balance.eth, 18),
    usdc: formatUnits(balance.usdc, USDC_DECIMALS),
  };
}
