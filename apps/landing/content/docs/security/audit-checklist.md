---
id: security-audit-checklist
title: Audit Checklist
sidebar_position: 3
---

# Audit Checklist

Pre-audit readiness status and known risk areas. See `contracts/SECURITY.md` in the repository for the full security notes and Slither triage.

## Access control inventory

| Contract | Privileged role | Functions |
|---|---|---|
| ChainPeRegistry | Owner (`Ownable2Step`) | `pause`, `unpause`, `setRegistrationFee`, `setUpdateFee`, `setFeeRecipient`, `setFeeToken`, `setIdentityRegistry`, `ownerWithdraw` |
| PolicyVault | Contract owner (deployer) | `pause`, `unpause` |
| PolicyVault | Vault owner (any address) | `deposit`, `withdraw`, `setPolicy`, `setAllowlist`, `revokeSession` |
| PolicyVault | Session key holder | signs `Spend` (no on-chain function, just signing) |
| PolicyVault | Any relayer | `spend` (submits signed authorization) |
| PolicyVault | Any address | `cleanupDailySpent` (gas reclaim, no funds moved) |
| ChainPeRegistry / PolicyVault proxies | Owner (Safe → `ChainPeTimelock` on Arbitrum One) | Upgrade authorization (`_authorizeUpgrade`) |
| ERC-8004 registries | Canonical deployer (not ChainPe) | ChainPe has no privileged role |

## Known risk areas

### Critical
- None identified post-audit. See `contracts/SECURITY.md` for the full critical findings resolution.

### High
- Facilitator gas key compromise: an attacker who obtains the facilitator key cannot steal payer USDC (EIP-3009 is already signed), but can prevent settlement by spending the gas balance. Mitigation: keep the gas key balance minimal (top up in small amounts).
- Registry fee token change race: a `setFeeToken` call while users have pending transactions can cause reverts. Mitigation: pause before changing fee token.

### Medium
- ERC-8004 Sybil reputation: anyone can post feedback on the canonical registry from fresh wallets. ChainPe's indexer counts only reviews that prove a payment to the service (one payment per review), so inflating a score costs real payments. The raw on-chain summary the SDK falls back to without an indexer is labelled `verified: false`.
- Indexer trustfulness: the indexer is an off-chain cache and verifier. Its verdicts can be re-derived from on-chain data and the feedback files.
- Sequencer dependence: Arbitrum's sequencer orders transactions and could delay settlements; force-inclusion through Ethereum remains available.

### Low
- PolicyVault `cleanupDailySpent` can be called by anyone; it only deletes past day slots. No funds can be moved. Primarily a gas optimization.
- String field validation in ChainPeRegistry: field lengths are checked (name ≤ 64, description ≤ 1024, etc.), but Unicode vs. byte counting: `bytes(input.name).length` counts bytes, not characters. Providers with multi-byte UTF-8 names may hit the limit unexpectedly.

## Static analysis

Slither and Aderyn (where applicable) are run as part of the CI pipeline. The output is recorded in `contracts/SECURITY.md`. The contracts had zero error-level findings at the time of audit submission.

## Fuzzing

:::note
Property-based fuzzing (e.g. Echidna) is not yet set up. This is a planned improvement before mainnet launch.
:::

## Upgrade safety

For upgradeable contracts:
- Storage layouts are documented in each contract and must not be reordered between upgrades
- `_authorizeUpgrade` is restricted to the owner (multisig on mainnet)
- New implementations must be independently reviewed before deployment
- `ChainPeTimelock` (`scripts/deploy-timelock.ts`, 48h default delay) owns the Arbitrum One contracts behind a Safe
