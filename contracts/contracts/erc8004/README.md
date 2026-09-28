# Vendored ERC-8004 (Trustless Agents) reference contracts

These Solidity sources are **vendored verbatim** from the official reference
implementation — they are NOT modified. They provide ChainPe's agent-reputation
layer (Identity + Reputation + Validation registries), which is intentionally
separate from `ChainPeRegistry.sol` (the service marketplace registry).

> **On Arbitrum, ChainPe does not deploy these.** Arbitrum One and Arbitrum Sepolia
> use the canonical singleton registries (`0x8004A169…a432` / `0x8004BAa1…9b63` on
> Arbitrum One, `0x8004A818…BD9e` / `0x8004B663…8713` on Sepolia). The vendored
> copies are kept for tests and local Hardhat networks.

- **Source:** https://github.com/erc-8004/erc-8004-contracts
- **Commit:** `68fc6765761a10fb26f0692df21c8a6f9d12b1be` (2026-06-11)
- **Spec:** [EIP-8004](https://eips.ethereum.org/EIPS/eip-8004) (Draft)

## Files

| File | Purpose |
|---|---|
| `IdentityRegistryUpgradeable.sol` | ERC-721 agent identities (the `agentId` ChainPe links to). |
| `ReputationRegistryUpgradeable.sol` | Feedback/reputation signals (`giveFeedback`, `getSummary`, …). |
| `ValidationRegistryUpgradeable.sol` | Validator attestations (optional; under active TEE-community revision). |
| `MinimalUUPS.sol` | Production bootstrap proxy impl (hardcoded owner — used for deterministic/vanity deploys). |
| `HardhatMinimalUUPS.sol` | Bootstrap proxy impl that sets `msg.sender` as owner — used by `scripts/deploy-erc8004.ts` for local/test deployments. |
| `ERC1967Proxy.sol` | Re-export of OpenZeppelin's ERC1967 proxy. |

## Deployment model (UUPS)

Each registry is deployed behind an ERC-1967 proxy using the reference project's
bootstrap pattern (their `initialize` is `reinitializer(2) onlyOwner`, so a plain
one-shot proxy init does not work):

1. Deploy `HardhatMinimalUUPS` and an `ERC1967Proxy` initialized with it
   (`initialize(address)` → sets `msg.sender` as owner).
2. Deploy the real registry implementation.
3. `proxy.upgradeToAndCall(realImpl, initialize[...])`.

See `scripts/deploy-erc8004.ts`. ABIs for off-chain clients live in
`contracts/abis/erc8004/`.

## Do not edit

Keep these files byte-for-byte identical to upstream so they stay audited and
interoperable. If an upgrade is needed, re-vendor from a newer upstream commit
and update the commit hash above.
