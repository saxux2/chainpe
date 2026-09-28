// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title PolicyVault
 * @notice Programmable, gasless spending policies for agent payments in USDC.
 *
 * An owner deposits USDC and grants a scoped **session key** (held by their
 * agent) a policy: per-call cap, daily cap, total budget, expiry, and an
 * optional recipient allowlist. The agent only *signs* spend authorizations
 * (EIP-712); a relayer (e.g. the ChainPe facilitator) submits `spend(...)` and
 * pays the ETH gas — so the agent spends **gaslessly**. Every constraint is
 * enforced **on-chain**: an over-cap or non-allowlisted attempt reverts, and the
 * owner can revoke the session at any time.
 *
 * This is the non-4337 path (see BUILD-PLAN §4.7): no smart-account/EIP-1271
 * complexity — just a vault that holds funds and releases them within policy.
 *
 * @dev The contract owner (deployer) may pause/unpause `deposit`, `spend`,
 * and `withdraw` as an emergency brake. Ownership follows OpenZeppelin Ownable
 * (transferable). The deployer becomes the initial owner.
 *
 * Trust assumptions:
 *  - Relayers: any address may submit `spend()`, but nothing forces a relayer to
 *    submit promptly. A malicious or offline relayer can hold a signed
 *    authorization until after `deadline`. If this occurs the session key can
 *    re-sign with a new deadline. Document this externally when integrating.
 *  - Fee token (USDC): USDC can blacklist addresses and is pausable/upgradeable
 *    by its issuer. If the vault or a `to` recipient is blacklisted, that
 *    `spend`/`withdraw` transfer reverts and the funds are frozen at the token
 *    layer — inherent to USDC and outside this contract's control.
 *
 * Timing: all windows use `block.timestamp` (never `block.number` — on Arbitrum
 * `block.number` is the L1 block). The daily cap resets at 00:00 UTC. Arbitrum's
 * sequencer may set timestamps somewhat off wall-clock time (bounded to ~24h
 * behind / ~1h ahead of L1), so expiries and deadlines are accurate to roughly
 * an hour at worst — don't rely on windows much shorter than that.
 */
contract PolicyVault is EIP712, ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    struct Policy {
        // Storage-packed: three full-word amounts (one slot each), then
        // sessionKey(20) + expiry(8) + allowlistOnly(1) + active(1) = 30 bytes
        // share a single slot — 4 slots total (was 5). Order only affects the
        // `policyOf` getter tuple; `setPolicy`'s signature is unchanged.
        uint256 maxPerCall; // max USDC per spend
        uint256 dailyCap;   // max USDC per UTC day (must be > 0)
        uint256 totalBudget; // lifetime cap for this session
        address sessionKey; // scoped signer (the agent)
        uint64 expiry;      // unix timestamp after which the session is invalid
        bool allowlistOnly; // if true, `to` must be allowlisted
        bool active;        // owner can flip off via revokeSession
    }

    /// owner => vault USDC balance
    mapping(address => uint256) public balanceOf;
    /// owner => active policy
    mapping(address => Policy) public policyOf;
    /// owner => recipient => allowed
    mapping(address => mapping(address => bool)) public allowlist;
    /// owner => lifetime spent under the current/last session
    mapping(address => uint256) public totalSpent;
    /// owner => UTC day index => spent that day
    mapping(address => mapping(uint256 => uint256)) public dailySpent;
    /// owner => spend nonce (single-use signatures, replay protection)
    mapping(address => uint256) public nonces;

    // NOTE: Do NOT change this typehash — doing so invalidates all existing
    // signed authorizations. The domain separator already scopes by contract
    // address and chainId; the typehash itself must remain stable.
    bytes32 private constant SPEND_TYPEHASH =
        keccak256(
            "Spend(address owner,address to,uint256 amount,uint256 nonce,uint256 deadline)"
        );

    // ─── Errors ───────────────────────────────────────────────────────────────

    error ZeroAddressToken();
    error ZeroAmount();
    error InsufficientBalance();
    error ZeroSessionKey();
    error ZeroDailyCap();
    error MaxPerCallExceedsBudget();
    error ExpiryInPast();
    error SessionInactive();
    error SessionExpired();
    error AuthExpired();
    error ZeroRecipient();
    error OverPerCallCap();
    error InsufficientVaultBalance();
    error OverTotalBudget();
    error OverDailyCap();
    error RecipientNotAllowlisted();
    error BadSessionSig();
    error CannotClearCurrentOrFutureDay();

    event Deposited(address indexed owner, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount);
    event PolicySet(
        address indexed owner,
        address indexed sessionKey,
        uint256 maxPerCall,
        uint256 dailyCap,
        uint256 totalBudget,
        uint64 expiry,
        bool allowlistOnly
    );
    event AllowlistUpdated(address indexed owner, address indexed to, bool allowed);
    event SessionRevoked(address indexed owner, address indexed sessionKey);
    event Spent(
        address indexed owner,
        address indexed to,
        uint256 amount,
        address indexed relayer,
        uint256 nonce
    );

    constructor(address _token) EIP712("ChainPePolicyVault", "1") Ownable(msg.sender) {
        if (_token == address(0)) revert ZeroAddressToken();
        token = IERC20(_token);
    }

    // ─── Emergency controls (owner only) ────────────────────────────────────

    /// @notice Pause deposit / spend / withdraw in case of emergency.
    function pause() external onlyOwner { _pause(); }

    /// @notice Resume normal operation.
    function unpause() external onlyOwner { _unpause(); }

    // ─── Funding ────────────────────────────────────────────────────────────

    /// @notice Deposit USDC into your vault (approve this contract first).
    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdraw your own unspent USDC at any time. Intentionally NOT
    /// pausable: pausing halts spending, but users must always be able to exit.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount > balanceOf[msg.sender]) revert InsufficientBalance();
        balanceOf[msg.sender] -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ─── Policy management (owner only, gas paid by owner) ──────────────────

    /**
     * @notice Set/replace the session policy for your vault.
     * @dev A fresh session resets `totalSpent` to zero. Callers who want to
     * replace a compromised session key should be aware that the new policy's
     * `totalBudget` starts from scratch — the previous session's spend history
     * is lost. `maxPerCall` must not exceed `totalBudget`; `dailyCap` must be
     * greater than zero (zero disables all spends). `expiry` must be in the
     * future.
     */
    function setPolicy(
        address sessionKey,
        uint256 maxPerCall,
        uint256 dailyCap,
        uint256 totalBudget,
        uint64 expiry,
        bool allowlistOnly
    ) external {
        if (sessionKey == address(0)) revert ZeroSessionKey();
        if (dailyCap == 0) revert ZeroDailyCap();
        if (maxPerCall > totalBudget) revert MaxPerCallExceedsBudget();
        if (expiry <= block.timestamp) revert ExpiryInPast();
        policyOf[msg.sender] = Policy({
            sessionKey: sessionKey,
            maxPerCall: maxPerCall,
            dailyCap: dailyCap,
            totalBudget: totalBudget,
            expiry: expiry,
            allowlistOnly: allowlistOnly,
            active: true
        });
        // A fresh session starts its lifetime budget from zero.
        totalSpent[msg.sender] = 0;
        emit PolicySet(
            msg.sender,
            sessionKey,
            maxPerCall,
            dailyCap,
            totalBudget,
            expiry,
            allowlistOnly
        );
    }

    function setAllowlist(address to, bool allowed) external {
        allowlist[msg.sender][to] = allowed;
        emit AllowlistUpdated(msg.sender, to, allowed);
    }

    /// @notice Immediately disable the session key.
    function revokeSession() external {
        Policy storage p = policyOf[msg.sender];
        p.active = false;
        emit SessionRevoked(msg.sender, p.sessionKey);
    }

    // ─── Gasless spend (submitted by any relayer) ───────────────────────────

    /**
     * @notice Release `amount` USDC from `owner`'s vault to `to`, authorized by
     * the owner's session key. Reverts unless every policy constraint holds.
     * The caller (relayer) pays gas; the session-key holder paid none.
     */
    function spend(
        address owner,
        address to,
        uint256 amount,
        uint256 deadline,
        bytes calldata sessionSig
    ) external nonReentrant whenNotPaused {
        Policy memory p = policyOf[owner];
        if (!p.active) revert SessionInactive();
        if (block.timestamp > p.expiry) revert SessionExpired();
        if (block.timestamp > deadline) revert AuthExpired();
        if (to == address(0)) revert ZeroRecipient();
        if (amount == 0) revert ZeroAmount();
        if (amount > p.maxPerCall) revert OverPerCallCap();
        if (balanceOf[owner] < amount) revert InsufficientVaultBalance();
        if (totalSpent[owner] + amount > p.totalBudget) revert OverTotalBudget();

        uint256 day = block.timestamp / 1 days;
        if (dailySpent[owner][day] + amount > p.dailyCap) revert OverDailyCap();

        if (p.allowlistOnly && !allowlist[owner][to]) revert RecipientNotAllowlisted();

        uint256 nonce = nonces[owner];
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(SPEND_TYPEHASH, owner, to, amount, nonce, deadline)
            )
        );
        if (ECDSA.recover(digest, sessionSig) != p.sessionKey) revert BadSessionSig();

        // Effects before interaction.
        nonces[owner] = nonce + 1;
        totalSpent[owner] += amount;
        dailySpent[owner][day] += amount;
        balanceOf[owner] -= amount;

        token.safeTransfer(to, amount);
        emit Spent(owner, to, amount, msg.sender, nonce);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    /// @notice USDC still spendable today under the daily cap (ignores balance).
    function dailyRemaining(address owner) external view returns (uint256) {
        Policy memory p = policyOf[owner];
        uint256 spent = dailySpent[owner][block.timestamp / 1 days];
        return p.dailyCap > spent ? p.dailyCap - spent : 0;
    }

    /// @notice USDC still spendable over the session's lifetime budget.
    function budgetRemaining(address owner) external view returns (uint256) {
        Policy memory p = policyOf[owner];
        return p.totalBudget > totalSpent[owner] ? p.totalBudget - totalSpent[owner] : 0;
    }

    /**
     * @notice Simulate whether a spend call would succeed, and if not, why.
     * @dev Useful for off-chain agents to check spend feasibility without
     * submitting a transaction. Does NOT verify the EIP-712 signature; callers
     * should call this before signing to confirm parameters are acceptable.
     */
    function previewSpend(
        address owner,
        address to,
        uint256 amount
    ) external view returns (bool ok, string memory reason) {
        Policy memory p = policyOf[owner];
        if (!p.active) return (false, "session inactive");
        if (block.timestamp > p.expiry) return (false, "session expired");
        if (to == address(0)) return (false, "to=0");
        if (amount == 0) return (false, "amount=0");
        if (amount > p.maxPerCall) return (false, "over per-call cap");
        if (balanceOf[owner] < amount) return (false, "insufficient vault balance");
        if (totalSpent[owner] + amount > p.totalBudget) return (false, "over total budget");
        uint256 day = block.timestamp / 1 days;
        if (dailySpent[owner][day] + amount > p.dailyCap) return (false, "over daily cap");
        if (p.allowlistOnly && !allowlist[owner][to]) return (false, "recipient not allowlisted");
        return (true, "");
    }

    /**
     * @notice Delete stale daily-spend storage slots to reclaim gas (EIP-3529 refund).
     * @dev Any caller may invoke this — it only clears days strictly in the past.
     *      The current day's slot is live and cannot be cleared.
     *      Typical usage: after a session expires, call with the day indices that
     *      accumulated spend during that session. Passing duplicates is safe
     *      (deleting an already-zero slot is a no-op).
     */
    function cleanupDailySpent(address owner, uint256[] calldata dayIndices) external {
        uint256 today = block.timestamp / 1 days;
        for (uint256 i = 0; i < dayIndices.length; ++i) {
            if (dayIndices[i] >= today) revert CannotClearCurrentOrFutureDay();
            delete dailySpent[owner][dayIndices[i]];
        }
    }

    /// @notice EIP-712 domain separator (handy for off-chain signers).
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
