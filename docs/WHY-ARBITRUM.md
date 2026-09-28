# Why Arbitrum for ChainPe

ChainPe is **pay-per-HTTP-request** infrastructure for AI agents: thousands of tiny,
independent USDC payments, each with an agent waiting on the result. That needs
low fees and fast settlement, which most L2s offer. ChainPe moved from Avalanche
C-Chain to Arbitrum One for what sits around the chain: the facilitators that
settle x402 payments, the stablecoin, the shared ERC-8004 registries and the x402
Bazaar.

## Native USDC with EIP-3009

- **Circle-issued USDC** at `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (6
  decimals, EIP-712 name `USD Coin`, version `2`) supports
  `transferWithAuthorization`. The payer only signs; the facilitator submits the
  transfer and pays gas, so agents hold USDC and no ETH.
- **USDT0** (`0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`) also supports EIP-3009
  (checked on-chain 2026-09-28: EIP-712 name `USD₮0`, version `1`), so providers
  can accept it the same way.
- Avoid the bridged `USDC.e` (`0xFF97…5CC8`); ChainPe payers refuse any token not
  in the SDK's network table.
- Testnet USDC for Arbitrum Sepolia is free from https://faucet.circle.com.

## Hosted facilitators, with failover

| Facilitator | Arbitrum One | Arbitrum Sepolia | Notes |
|---|---|---|---|
| **Coinbase CDP** | Yes | No | Needs API keys; 1k settlements/month free, then $0.001. Settling through CDP lists the resource in the x402 Bazaar. |
| **PayAI** | Yes | Yes | No keys; free tier, then $0.001. ChainPe's testnet default. |
| **ChainPe facilitator** | Yes | Yes | Self-hosted fallback (`services/chainpe-facilitator`). |

Avalanche had one hosted option (PayAI) and ChainPe's own. On Arbitrum the proxy
defaults to CDP then PayAI and fails over between them, so no single facilitator
outage stops payments.

## Canonical ERC-8004 registries

The ERC-8004 Identity and Reputation registries are deployed as singletons at the
same vanity addresses on every chain:

| | Arbitrum One | Arbitrum Sepolia |
|---|---|---|
| Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

On Avalanche ChainPe ran its own copies. On Arbitrum it joins the shared registry,
so ChainPe agents resolve in any ERC-8004 tool and ChainPe can rank agents
registered elsewhere. To resist fake reviews, ChainPe's indexer counts only
feedback that carries a verified proof of a USDC payment to the service.

## The x402 Bazaar

Coinbase's x402 Bazaar is a public catalog of paid x402 resources. It lists a
resource after its first payment settled through CDP, and CDP settles on Arbitrum
One (a Bazaar search on 2026-09-28 returned Arbitrum USDC services). ChainPe
providers declare Bazaar metadata on every 402, and ChainPe's `discover()` merges
the Bazaar with its own registry and ERC-8004 registrations. That makes ChainPe a
discovery layer across x402, not a closed marketplace.

## Speed and costs

- **Blocks every ~250 ms.** The sequencer confirms a settlement within a block, so
  a facilitator can return the paid response right away. Hard finality comes when
  the batch is posted to Ethereum.
- **Fees.** Measured on 2026-09-28: Arbitrum One gas price **0.02 gwei**, ETH at
  **$2,643**. Execution cost at that price:

| ChainPe operation | ~gas | Execution cost |
|---|---|---|
| x402 settlement (USDC EIP-3009 transfer) | 75k | ~$0.004 |
| ERC-8004 `giveFeedback` | 120k | ~$0.006 |
| Register a service | 210k | ~$0.011 |
| PolicyVault gasless spend | 95k | ~$0.005 |

Arbitrum adds an L1 data fee on top, which moves with Ethereum blob prices. The
facilitator pays settlement gas; reviewers pay for their own feedback. Measured
receipts from Arbitrum Sepolia will be recorded in `docs/DEPLOYMENTS.md` during
testnet validation.

## Moving USDC from Avalanche

Circle's CCTP V2 burns USDC on Avalanche and mints it on Arbitrum One directly
(Arbitrum is CCTP domain 3, Avalanche domain 1), so funds move without a
third-party bridge.

## What Arbitrum doesn't give ChainPe

- **Demand.** Most x402 volume settles on Base; Arbitrum support arrived in mid-2026.
  The gains are reliability and discoverability, not an existing buyer pool.
- **Cross-chain messaging.** Avalanche ICM has no Arbitrum equivalent in ChainPe;
  the ICM contracts were removed.
- **State.** Registered services, agent ids, feedback and vault balances on
  Avalanche do not carry over. Providers re-register on Arbitrum.
