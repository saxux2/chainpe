/**
 * Bridges the deployer's Ethereum Sepolia ETH to Arbitrum Sepolia through the
 * official Arbitrum Inbox (depositEth). Use this when the Arbitrum Sepolia
 * faucets refuse: get Sepolia ETH (e.g. the sepolia-faucet.pk910.de PoW faucet)
 * to the deployer address first. Arrives on Arbitrum Sepolia in ~10–15 minutes.
 *
 *   node e2e/testnet/bridge.mjs              # bridges everything except 0.002 ETH for L1 gas
 *   BRIDGE_ETH=0.02 node e2e/testnet/bridge.mjs
 */
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { key, record } from './lib.mjs'

// Arbitrum Sepolia's Inbox on Ethereum Sepolia (its bridge() is 0x38f918D0…33a9).
const INBOX = '0xaAe29B0366299461418F5324a79Afc425BE5ae21'
const RPC = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'
const inboxAbi = [{ type: 'function', name: 'depositEth', stateMutability: 'payable', inputs: [], outputs: [{ type: 'uint256' }] }]

const account = privateKeyToAccount(key('DEPLOYER_PRIVATE_KEY'))
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) })
if ((await pub.getChainId()) !== sepolia.id) throw new Error('SEPOLIA_RPC_URL is not Ethereum Sepolia.')
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) })

const balance = await pub.getBalance({ address: account.address })
const reserve = parseEther('0.002')
const amount = process.env.BRIDGE_ETH ? parseEther(process.env.BRIDGE_ETH) : balance - reserve
console.log(`deployer ${account.address}: ${formatEther(balance)} ETH on Ethereum Sepolia`)
if (amount <= 0n || amount + reserve > balance) {
  console.error(`Not enough Sepolia ETH to bridge (keep ${formatEther(reserve)} for gas).`)
  process.exit(1)
}

const hash = await wallet.writeContract({ address: INBOX, abi: inboxAbi, functionName: 'depositEth', value: amount })
const receipt = await pub.waitForTransactionReceipt({ hash })
if (receipt.status !== 'success') throw new Error(`depositEth reverted: https://sepolia.etherscan.io/tx/${hash}`)
record({ step: '6.0', what: `bridged ${formatEther(amount)} ETH Ethereum Sepolia → Arbitrum Sepolia (L1 tx)`, note: `https://sepolia.etherscan.io/tx/${hash}` })
console.log(`✓ deposited ${formatEther(amount)} ETH  https://sepolia.etherscan.io/tx/${hash}`)
console.log('  It reaches the same address on Arbitrum Sepolia in ~10–15 min; check with node e2e/testnet/status.mjs')
