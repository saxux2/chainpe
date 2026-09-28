---
id: payment-validation
title: Payment Validation
sidebar_position: 3
---

# Payment Validation

After the proxy receives a request with a `PAYMENT-SIGNATURE` header, it asks a facilitator to verify the payment before forwarding the request.

## Verify endpoint

The proxy sends the payload to its first reachable facilitator — Coinbase CDP, PayAI, or your own `services/chainpe-facilitator`:

```
POST https://facilitator.payai.network/verify
Content-Type: application/json

{
  "x402Version": 2,
  "paymentPayload": { ... signed x402 payload ... },
  "paymentRequirements": { ... the offer from the 402 response ... }
}
```

If a facilitator is unreachable (network error, 5xx), the proxy's failover client tries the next one. A definite "invalid" answer is not retried.

### What verify checks

The x402 `exact` EVM scheme checks:

1. **Scheme and network** — `exact` on a network the facilitator supports (`eip155:42161` or `eip155:421614`)
2. **Asset and recipient** — the authorization's token and `to` match the offer
3. **Amount** — `value` equals the offer's `amount`
4. **Validity window** — `validAfter` / `validBefore` include now
5. **Signature** — the EIP-712 signature recovers to `authorization.from`
6. **Balance** — `from` holds enough of the token
7. **Nonce** — the authorization nonce hasn't been used

### Response

```json
{ "isValid": true, "payer": "0xAgentWallet" }
```

Or on failure:
```json
{
  "isValid": false,
  "invalidReason": "invalid_exact_evm_payload_signature"
}
```

On a failed verify the proxy answers `402` again and never forwards the request.

## On-chain verification (USDC contract)

The final check happens on-chain when the facilitator calls `transferWithAuthorization`. The USDC contract independently verifies:

1. The EIP-3009 signature
2. That `from` has sufficient USDC balance
3. That `validAfter < block.timestamp < validBefore`
4. That the nonce has not been used (USDC stores used authorization nonces)

If any of these fail, the transfer reverts and settlement fails. The SDK surfaces this as a `ChainPePaymentError` ("payment signed but the server could not settle").
