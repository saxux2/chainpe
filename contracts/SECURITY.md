# ChainPe Contracts — Security Notes

Scope: the custom ChainPe contracts for Arbitrum One and Arbitrum Sepolia —
`ChainPeRegistryUpgradeable`, `PolicyVaultUpgradeable`, `ChainPeTimelock`. (The
`erc8004/*` registries are vendored reference implementations used in tests; live
networks use the canonical ERC-8004 registries, which ChainPe does not own.)

## Static analysis (Slither)

Run per-contract (the whole-project run trips on the duplicate `ERC1967Proxy`
contract name — OZ's vs. the vendored ERC-8004 one — which is a tooling quirk,
not a code issue):

```bash
solc-select use 0.8.28
slither contracts/contracts/PolicyVaultUpgradeable.sol \
  --solc-remaps "@openzeppelin=node_modules/@openzeppelin" --exclude-dependencies
```

### Triage — all findings reviewed, none are exploitable

| Finding | Where | Disposition |
|---|---|---|
| `incorrect-exp`, `divide-before-multiply` | OZ `Math.sol` | Library code, false positive. Not ours. |
| `unused-return` on `functionDelegateCall` | OZ `ERC1967Utils` | Library code. Not ours. |
| `shadowing-local`: `owner` param shadows `Ownable.owner()` | PolicyVault `spend`/`previewSpend`/etc. | **Accepted.** The param name `owner` matches the EIP-712 `Spend(address owner,...)` schema and the event/getter names. The functions never call the `owner()` getter, so there is no behavioural shadowing. Severity: low/style. |
| `block-timestamp` used for comparisons | PolicyVault expiry/deadline/daily-cap | **Accepted & required.** All windows are multi-hour; validator timestamp drift (seconds) cannot meaningfully game them. |
| `missing-zero-address-validation` on `identityRegistry_` / `setIdentityRegistry` | ChainPeRegistry | **By design.** `identityRegistry == address(0)` is the documented "unset" state. |

The fund-custody contract (`PolicyVaultUpgradeable`) follows checks-effects-
interactions, uses `nonReentrant` on `deposit`/`spend`, EIP-712 + per-owner nonces
for replay protection, and keeps `withdraw` always available (not pausable) so a
pause cannot trap user funds.

## Trust assumptions

- **USDC is centrally administered.** It can blacklist addresses and is
  pausable/upgradeable by Circle. A blacklisted vault or recipient freezes the
  affected transfer at the token layer — outside this contract's control.
- **Relayers (PolicyVault `spend`)** are permissionless and not forced to submit
  promptly; a held authorization is recovered by re-signing with a fresh
  `deadline`.
- **Owner** controls UUPS upgrades. On Arbitrum One the deploy scripts refuse a
  deployer-EOA owner; ownership goes to a Safe and then a `ChainPeTimelock` (see checklist).
- **Arbitrum sequencer.** Offchain Labs runs the sequencer; it orders transactions
  and could delay them (force-inclusion through Ethereum remains available).
  PolicyVault windows use `block.timestamp`, never `block.number`, because
  Arbitrum's `block.number` returns the L1 block number.
- **Canonical ERC-8004 registries** are third-party contracts. ChainPe only reads
  them and writes feedback; the indexer verifies proofs of payment off-chain.

## Post-deploy checklist (mainnet)

- [ ] **Professional audit** + bug bounty now that real-money TVL is live. These notes and
      the Slither pass are a first filter, not a substitute.
- [ ] Deploy `ChainPeTimelock` (24–48h delay), proposers = Gnosis Safe.
      `scripts/deploy-timelock.ts`.
- [ ] Deploy registry + vault with `OWNER_ADDRESS=<timelock>`. The deploy scripts
      now **refuse** a deployer-EOA owner on mainnet unless `ALLOW_DEPLOYER_OWNER=true`.
- [ ] Full integration test (on an Arbitrum One fork): deposit → setPolicy → relayed spend → withdraw → pause,
      plus a proxy-upgrade rehearsal through the timelock.
- [ ] Verify the implementation contracts on Arbiscan after deploy (`npm run verify:mainnet`).
