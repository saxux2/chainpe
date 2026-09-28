---
id: payment-settlement
title: Payment Settlement
sidebar_position: 4
---

# Payment Settlement

Settlement is the on-chain phase where USDC moves from the agent's wallet to the provider's wallet. It happens in a single Arbitrum transaction submitted by the facilitator.

## Settle endpoint

```
POST https://facilitator.payai.network/settle
Content-Type: application/json

{
  "x402Version": 2,
  "paymentPayload": { ... signed x402 payload ... },
  "paymentRequirements": { ... offer from 402 ... }
}
```

The proxy uses the same facilitator list as for verify (CDP → PayAI on Arbitrum One, PayAI on Arbitrum Sepolia, or your configured list).

## What happens on-chain

The facilitator calls `USDC.transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, signature)` where:

- `from` = agent's wallet address
- `to` = provider's `payTo` address
- `value` = the exact amount in atomic units (e.g. `10000` for 0.01 USDC, 6 decimals)
- `validAfter` / `validBefore` = validity window from the signed authorization
- `nonce` = the random bytes32 from the signed authorization

Native USDC on Arbitrum (`0xaf88…5831`, and `0x75fa…AA4d` on Sepolia) and USDT0 on Arbitrum One support EIP-3009 natively.

## Gas

The facilitator pays all ETH gas; the agent never needs ETH. A `transferWithAuthorization` uses roughly 60,000–80,000 gas. At the 0.02 gwei Arbitrum One gas price measured on 2026-09-28, the execution cost is well under a cent, plus an L1 data fee that moves with Ethereum blob prices.

## Settlement response

```json
{
  "success": true,
  "transaction": "0xabc123def456...",
  "network": "eip155:42161",
  "payer": "0xAgentWallet"
}
```

The proxy returns it base64-encoded in the `PAYMENT-RESPONSE` header, and `cp.pay()` surfaces it as `result.payment.txHash`.

## Finality

Arbitrum's sequencer orders transactions into ~250 ms blocks and confirms inclusion immediately; that is when the facilitator reports success. The transaction becomes final on Ethereum once its batch is posted and the L1 block finalizes. For per-request payments, sequencer confirmation is the practical settlement point.

## PolicyVault settlement

When using a PolicyVault, settlement is different:

1. The agent signs an EIP-712 `Spend` authorization off-chain
2. A relayer calls `PolicyVault.spend(owner, to, amount, deadline, sig)`
3. The contract verifies the session signature and all policy constraints
4. The contract transfers USDC to `to` directly from the vault balance

The vault holds USDC deposited by the owner; no EIP-3009 is involved.

## Monitoring a self-hosted facilitator

`services/chainpe-facilitator` exposes counters at `/metrics`:

```
chainpe_settle_total{result="success"} 42
chainpe_settle_total{result="error"} 1
chainpe_gas_balance_eth{network="arbitrum",facilitator="0x…"} 0.012
```

`/health` reports `degraded` when a network's gas balance is below 0.002 ETH.
