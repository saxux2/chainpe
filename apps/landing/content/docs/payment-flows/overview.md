---
id: payment-flows-overview
title: Payment Flows
sidebar_position: 1
---

# Payment Flows

ChainPe supports two payment paths. Both settle in USDC on Arbitrum; they differ in who signs what and who pays gas.

## Standard x402 flow (EIP-3009)

The most common path. The agent wallet signs a USDC `transferWithAuthorization` and a facilitator submits it on-chain:

1. **Initiation** — agent sends request; server returns 402 with a `PAYMENT-REQUIRED` offer
2. **Signing** — agent signs an EIP-3009 authorization off-chain (no gas) and retries with `PAYMENT-SIGNATURE`
3. **Validation** — the proxy has a facilitator (Coinbase CDP or PayAI, with failover) verify the payment
4. **Settlement** — the facilitator submits the authorization; Arbitrum includes it in the next block (~250 ms)
5. **Response** — server returns 200 with a `PAYMENT-RESPONSE` header

[Initiation →](./initiation.md) · [Validation →](./validation.md) · [Settlement →](./settlement.md)

## PolicyVault flow (EIP-712)

For agents that operate under an owner-defined spending policy:

1. **Funding** — owner deposits USDC into PolicyVault and sets a policy
2. **Signing** — agent signs an EIP-712 `Spend` authorization off-chain (no gas)
3. **Relay** — relayer submits `PolicyVault.spend()` and pays gas
4. **On-chain enforcement** — contract checks all policy constraints before transferring

[PolicyVault concept →](../concepts/policy-vaults.md)
