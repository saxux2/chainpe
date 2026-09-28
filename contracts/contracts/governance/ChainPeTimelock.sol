// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title ChainPeTimelock
 * @notice A thin OpenZeppelin {TimelockController} intended to OWN ChainPe's
 * upgradeable contracts (PolicyVaultUpgradeable, ChainPeRegistryUpgradeable).
 *
 * Routing every owner action — including UUPS upgrades via `_authorizeUpgrade` —
 * through a timelock gives depositors a guaranteed, on-chain-visible delay window
 * to react to (or withdraw ahead of) any privileged action. This is the single
 * biggest fund-safety improvement for a vault that custodies user USDC: a
 * compromised multisig can no longer drain funds in one block via a malicious
 * upgrade.
 *
 * Recommended mainnet setup:
 *   - minDelay:  24–48h (86400–172800 seconds).
 *   - proposers: [Gnosis Safe multisig]
 *   - executors: [Gnosis Safe multisig] (or [address(0)] = anyone may execute
 *                once the delay elapses).
 *   - admin:     address(0) — renounce the admin role so the timelock is
 *                self-governed and no single key can reconfigure it.
 *
 * After deploying, set this contract's address as `OWNER_ADDRESS` when deploying
 * the registry and vault, or transfer ownership to it via transfer-ownership.ts.
 */
contract ChainPeTimelock is TimelockController {
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {}
}
