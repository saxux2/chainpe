// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TestARB
 * @notice Stand-in for ARB on Arbitrum Sepolia, where ARB has no market.
 *         Paired with testnet USDC in a Uniswap v3 pool so swap demos work.
 *         Worthless; NOT for production use.
 */
contract TestARB is ERC20 {
    constructor(address holder, uint256 supply) ERC20("Test Arbitrum", "tARB") {
        _mint(holder, supply);
    }
}
