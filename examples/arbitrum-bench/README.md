# Arbitrum benchmark

Live measurement of the Arbitrum properties ChainPe depends on — block time and
gas price — plus execution-cost estimates for ChainPe operations. Optionally
runs **one real x402-style settlement** and reports its latency and actual fee.

```bash
npm install                                   # links the local @chainpe/sdk (build it first)
node bench.mjs                                # Arbitrum Sepolia, read-only
CHAINPE_NETWORK=arbitrum node bench.mjs       # Arbitrum One, read-only
BENCH_PRIVATE_KEY=0x… node bench.mjs          # + one measured settlement
ETH_USD=2600 node bench.mjs                   # fixed ETH price (default: Coinbase spot)
```

## Measured settlement

With `BENCH_PRIVATE_KEY` set, the key signs an EIP-3009
`transferWithAuthorization` for **0.01 USDC to itself** and submits it, exactly
as a facilitator would. The wallet needs 0.01 USDC (free on Arbitrum Sepolia at
https://faucet.circle.com) and a little ETH for gas. Nothing leaves the wallet
except the gas.

The script prints the explorer link, submit→receipt latency, `gasUsed` and the
fee paid. On Arbitrum, `gasUsed` already includes the L1 data component, so the
fee is the real all-in cost. Record the results in `docs/DEPLOYMENTS.md` during
testnet validation.

## Notes

- Execution-cost estimates use typical gas per operation at the live gas price
  and leave out the L1 data fee, which varies with Ethereum blob prices.
- Arbitrum block timestamps have 1-second resolution, so block time is averaged
  over the last 200 blocks.
- Why Arbitrum: [`docs/WHY-ARBITRUM.md`](../../docs/WHY-ARBITRUM.md).
