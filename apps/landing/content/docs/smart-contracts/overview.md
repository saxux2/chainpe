---
id: smart-contracts-overview
title: Smart Contracts Overview
sidebar_position: 1
slug: /smart-contracts/overview
---

# Smart Contracts

ChainPe's own contracts are written in Solidity 0.8.28 and use OpenZeppelin libraries. The Hardhat suite has 86 tests plus an Arbitrum One fork test. For identity and reputation, ChainPe uses the canonical ERC-8004 registries instead of deploying its own.

## Addresses

### ChainPe contracts

ChainPeRegistry and PolicyVault are not deployed on Arbitrum yet. Their addresses (proxy, implementation, deploy block, registration fee) will be published in `docs/DEPLOYMENTS.md` in the repository. Until then, pass them with `CHAINPE_REGISTRY_ADDRESS` / `POLICY_VAULT_ADDRESS` or deploy your own.

### Canonical contracts

| Contract | Arbitrum One (42161) | Arbitrum Sepolia (421614) |
|---|---|---|
| ERC-8004 IdentityRegistry | [`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`](https://arbiscan.io/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) | [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://sepolia.arbiscan.io/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) |
| ERC-8004 ReputationRegistry | [`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`](https://arbiscan.io/address/0x8004BAa17C55a88189AE136b182e5fdA19dE9b63) | [`0x8004B663056A597Dffe9eCcC1965A193B7388713`](https://sepolia.arbiscan.io/address/0x8004B663056A597Dffe9eCcC1965A193B7388713) |
| USDC (Circle, native) | [`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`](https://arbiscan.io/token/0xaf88d065e77c8cC2239327C5EDb3A432268e5831) | [`0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`](https://sepolia.arbiscan.io/token/0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d) |
| USDT0 | [`0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`](https://arbiscan.io/token/0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9) | — |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | same |

## Network configuration

| Network | Chain ID | x402 network | Explorer |
|---|---|---|---|
| Arbitrum One | 42161 | `eip155:42161` | [arbiscan.io](https://arbiscan.io) |
| Arbitrum Sepolia | 421614 | `eip155:421614` | [sepolia.arbiscan.io](https://sepolia.arbiscan.io) |

## Registry config defaults

Set at deploy time by `contracts/scripts/deploy.ts`:

- Fee token: native USDC for the network (`FEE_TOKEN_ADDRESS` to override)
- Registration fee: **1 USDC** (`REGISTRATION_FEE_USDC`); the owner can change it with `setRegistrationFee`
- Update fee: **0** (free updates) until the owner calls `setUpdateFee`
- Identity registry: the canonical ERC-8004 IdentityRegistry
- Owner: a Safe multisig (required on Arbitrum One), then `ChainPeTimelock`

## Source files

| Contract | Source |
|---|---|
| ChainPeRegistry | `contracts/contracts/ChainPeRegistry.sol` |
| ChainPeRegistryUpgradeable | `contracts/contracts/ChainPeRegistryUpgradeable.sol` |
| PolicyVault | `contracts/contracts/PolicyVault.sol` |
| PolicyVaultUpgradeable | `contracts/contracts/PolicyVaultUpgradeable.sol` |
| ChainPeTimelock | `contracts/contracts/governance/ChainPeTimelock.sol` |
| ERC-8004 reference (tests only) | `contracts/contracts/erc8004/` |

## Detailed references

- [ChainPeRegistry](./chainpe-registry.md) — service marketplace, events, access control
- [PolicyVault](./policy-vault.md) — gasless spending policies
- [Upgradeable Contracts](./upgradeable-contracts.md) — UUPS proxy pattern and upgrade process
