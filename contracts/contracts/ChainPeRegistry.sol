// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title ChainPeRegistry
 * @notice On-chain registry of x402-gated API services for the ChainPe
 *         marketplace on Arbitrum. This is the EVM successor to the
 *         Algorand ARC-4 `ChainPeRegistry` contract.
 *
 * @dev Migration notes (Algorand -> EVM):
 *      - ARC-54 BoxMap (keyed by `developer:name`) -> `mapping(bytes32 => Service)`
 *        keyed by `keccak256(abi.encode(developer, name))`.
 *      - 1-ALGO grouped payment to admin -> ERC-20 (USDC) `registrationFee`
 *        pulled via `transferFrom` to `feeRecipient`.
 *      - Box enumeration via the Algorand Indexer -> Solidity events
 *        (`ServiceRegistered` / `ServiceUpdated` / `ServiceDeregistered`) plus a
 *        paginated on-chain view (`getServices`), so discovery needs no
 *        off-chain indexing infrastructure.
 *      - Hardcoded admin -> `Ownable2Step` owner with settable fee parameters.
 *      - Agent reputation is intentionally NOT part of this contract; it is
 *        handled by the ERC-8004 Identity + Reputation registries. A service may
 *        optionally link to its ERC-8004 `agentId` so consumers can look up the
 *        provider's portable reputation.
 *
 * Storage layout (do not reorder when upgrading via a proxy in the future):
 *   slot: feeToken (IERC20)
 *   slot: feeRecipient (address)
 *   slot: registrationFee (uint256, in feeToken atomic units, USDC = 6 decimals)
 *   slot: identityRegistry (address, ERC-8004 Identity Registry; 0 = unset)
 *   mapping: _services (bytes32 => Service)
 *   array:   _serviceKeys (bytes32[])
 *   mapping: _keyIndex (bytes32 => uint256, 1-based; 0 = absent)
 */
contract ChainPeRegistry is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------------

    uint256 public constant MAX_SERVICES_PER_PAGE = 100;

    uint256 private constant MAX_NAME_LEN = 64;
    uint256 private constant MAX_DESC_LEN = 1024;
    uint256 private constant MAX_TAGS_LEN = 256;
    uint256 private constant MAX_ENDPOINT_LEN = 256;
    uint256 private constant MAX_PRICE_LEN = 32;

    // ------------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------------

    /**
     * @notice A registered service listing.
     * @dev String fields mirror the original Algorand schema for client parity.
     *      `payTo` and `developer` are native addresses (the Algorand version
     *      stored these as base32 strings).
     */
    struct Service {
        string name;
        string description;
        string tags; // comma-separated keywords
        string endpoint; // public x402-gated URL
        string pricePerRequest; // human-readable, e.g. "0.01"
        string paymentToken; // "USDC" | "USDT0"
        string network; // "arbitrum" | "arbitrum-sepolia"
        address payTo; // where the provider receives payments
        address developer; // owner of this listing
        uint256 agentId; // ERC-8004 agent identity (0 = unlinked)
        uint64 createdAt;
        uint64 updatedAt;
        bool exists;
    }

    /// @notice Calldata bundle for register/update to keep the ABI compact.
    struct ServiceInput {
        string name;
        string description;
        string tags;
        string endpoint;
        string pricePerRequest;
        string paymentToken;
        string network;
        address payTo;
        uint256 agentId;
    }

    // ------------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------------

    IERC20 public feeToken;
    address public feeRecipient;
    uint256 public registrationFee;
    /// @notice Fee charged on `update()`. Defaults to 0 (free updates).
    /// Set lower than `registrationFee` to incentivize keeping listings fresh.
    uint256 public updateFee;
    address public identityRegistry;

    mapping(bytes32 => Service) private _services;
    bytes32[] private _serviceKeys;
    mapping(bytes32 => uint256) private _keyIndex; // 1-based index into _serviceKeys

    // ------------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------------

    event ServiceRegistered(
        bytes32 indexed key,
        address indexed developer,
        string name,
        string endpoint,
        string pricePerRequest,
        string paymentToken,
        address payTo,
        uint256 indexed agentId
    );

    event ServiceUpdated(
        bytes32 indexed key,
        address indexed developer,
        string name,
        string endpoint,
        string pricePerRequest,
        string paymentToken,
        address payTo,
        uint256 indexed agentId
    );

    event ServiceDeregistered(bytes32 indexed key, address indexed developer, string name);

    event RegistrationFeePaid(address indexed payer, address indexed feeRecipient, uint256 amount);

    event FeeTokenUpdated(address indexed oldToken, address indexed newToken);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event RegistrationFeeUpdated(uint256 oldFee, uint256 newFee);
    event UpdateFeeUpdated(uint256 oldFee, uint256 newFee);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    // ------------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------------

    error ServiceAlreadyExists(bytes32 key);
    error ServiceNotFound(bytes32 key);
    error NotServiceDeveloper(address caller, address developer);
    error ZeroAddress();
    error EmptyName();
    error StringTooLong(string field);
    error InvalidPagination(uint256 offset, uint256 limit);

    // ------------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------------

    /**
     * @param feeToken_        ERC-20 used for the registration fee (USDC).
     * @param feeRecipient_    Treasury that receives registration fees.
     * @param registrationFee_ Fee per register/update, in `feeToken_` atomic units.
     * @param identityRegistry_ ERC-8004 Identity Registry address (may be 0; settable later).
     * @param owner_           Initial contract owner.
     */
    constructor(
        IERC20 feeToken_,
        address feeRecipient_,
        uint256 registrationFee_,
        address identityRegistry_,
        address owner_
    ) Ownable(owner_) {
        if (address(feeToken_) == address(0)) revert ZeroAddress();
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        if (owner_ == address(0)) revert ZeroAddress();
        feeToken = feeToken_;
        feeRecipient = feeRecipient_;
        registrationFee = registrationFee_;
        identityRegistry = identityRegistry_; // 0 allowed
    }

    // ------------------------------------------------------------------------
    // Emergency controls (owner only)
    // ------------------------------------------------------------------------

    /// @notice Pause register / update / deregister in case of emergency.
    function pause() external onlyOwner { _pause(); }

    /// @notice Resume normal operation.
    function unpause() external onlyOwner { _unpause(); }

    // ------------------------------------------------------------------------
    // Key helper
    // ------------------------------------------------------------------------

    /// @notice Deterministic storage key for a (developer, name) pair.
    function computeKey(address developer, string memory name) public pure returns (bytes32) {
        return keccak256(abi.encode(developer, name));
    }

    // ------------------------------------------------------------------------
    // Write: register / update / deregister
    // ------------------------------------------------------------------------

    /**
     * @notice Register a new service. Caller must have approved at least
     *         `registrationFee` of `feeToken` to this contract.
     * @dev `msg.sender` becomes the listing's `developer`. Reverts if a listing
     *      with the same (developer, name) already exists.
     *      String fields are capped: name ≤ 64 B, description ≤ 1024 B,
     *      tags ≤ 256 B, endpoint ≤ 256 B, pricePerRequest ≤ 32 B.
     */
    function register(ServiceInput calldata input) external nonReentrant whenNotPaused returns (bytes32 key) {
        if (bytes(input.name).length == 0) revert EmptyName();
        if (input.payTo == address(0)) revert ZeroAddress();
        _validateInput(input);

        key = computeKey(msg.sender, input.name);
        if (_services[key].exists) revert ServiceAlreadyExists(key);

        uint64 nowTs = uint64(block.timestamp);
        _services[key] = Service({
            name: input.name,
            description: input.description,
            tags: input.tags,
            endpoint: input.endpoint,
            pricePerRequest: input.pricePerRequest,
            paymentToken: input.paymentToken,
            network: input.network,
            payTo: input.payTo,
            developer: msg.sender,
            agentId: input.agentId,
            createdAt: nowTs,
            updatedAt: nowTs,
            exists: true
        });

        _serviceKeys.push(key);
        _keyIndex[key] = _serviceKeys.length; // 1-based

        _collectFee();

        emit ServiceRegistered(
            key,
            msg.sender,
            input.name,
            input.endpoint,
            input.pricePerRequest,
            input.paymentToken,
            input.payTo,
            input.agentId
        );
    }

    /**
     * @notice Update an existing service. Only the original developer may call.
     *         Requires the registration fee (mirrors the Algorand contract,
     *         which charged 1 ALGO on update as well).
     * @dev Note: `setFeeToken` changes take effect immediately. If the owner
     *      changes `feeToken`, callers who approved the old token must re-approve
     *      the new one. Consider pausing the contract before changing the fee token.
     */
    function update(ServiceInput calldata input) external nonReentrant whenNotPaused returns (bytes32 key) {
        if (input.payTo == address(0)) revert ZeroAddress();
        _validateInput(input);

        key = computeKey(msg.sender, input.name);
        Service storage svc = _services[key];
        if (!svc.exists) revert ServiceNotFound(key);
        // Implicit: only the developer can produce this key, but assert anyway.
        if (svc.developer != msg.sender) revert NotServiceDeveloper(msg.sender, svc.developer);

        svc.description = input.description;
        svc.tags = input.tags;
        svc.endpoint = input.endpoint;
        svc.pricePerRequest = input.pricePerRequest;
        svc.paymentToken = input.paymentToken;
        svc.network = input.network;
        svc.payTo = input.payTo;
        svc.agentId = input.agentId;
        svc.updatedAt = uint64(block.timestamp);

        _collectUpdateFee();

        emit ServiceUpdated(
            key,
            msg.sender,
            input.name,
            input.endpoint,
            input.pricePerRequest,
            input.paymentToken,
            input.payTo,
            input.agentId
        );
    }

    /**
     * @notice Remove a service. Only the original developer may call. No fee.
     */
    function deregister(string calldata name) external nonReentrant whenNotPaused {
        bytes32 key = computeKey(msg.sender, name);
        Service storage svc = _services[key];
        if (!svc.exists) revert ServiceNotFound(key);
        if (svc.developer != msg.sender) revert NotServiceDeveloper(msg.sender, svc.developer);

        _removeKey(key);
        delete _services[key];

        emit ServiceDeregistered(key, msg.sender, name);
    }

    // ------------------------------------------------------------------------
    // Read
    // ------------------------------------------------------------------------

    function getService(address developer, string calldata name) external view returns (Service memory) {
        bytes32 key = computeKey(developer, name);
        Service memory svc = _services[key];
        if (!svc.exists) revert ServiceNotFound(key);
        return svc;
    }

    function getServiceByKey(bytes32 key) external view returns (Service memory) {
        Service memory svc = _services[key];
        if (!svc.exists) revert ServiceNotFound(key);
        return svc;
    }

    function hasService(address developer, string calldata name) external view returns (bool) {
        return _services[computeKey(developer, name)].exists;
    }

    /// @notice Total number of registered services.
    function getServiceCount() external view returns (uint256) {
        return _serviceKeys.length;
    }

    /**
     * @notice Paginated list of services — the EVM replacement for Algorand box
     *         enumeration. Returns up to `limit` services starting at `offset`.
     *         `limit` is capped at `MAX_SERVICES_PER_PAGE` (100).
     */
    function getServices(uint256 offset, uint256 limit) external view returns (Service[] memory page) {
        uint256 total = _serviceKeys.length;
        if (offset > total) revert InvalidPagination(offset, limit);
        if (limit == 0) revert InvalidPagination(offset, limit);
        if (limit > MAX_SERVICES_PER_PAGE) revert InvalidPagination(offset, limit);

        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 size = end - offset;

        page = new Service[](size);
        for (uint256 i = 0; i < size; ++i) {
            page[i] = _services[_serviceKeys[offset + i]];
        }
    }

    /// @notice The storage key at a given index (for advanced/off-chain use).
    function getServiceKeyAt(uint256 index) external view returns (bytes32) {
        return _serviceKeys[index];
    }

    // ------------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------------

    function setRegistrationFee(uint256 newFee) external onlyOwner {
        emit RegistrationFeeUpdated(registrationFee, newFee);
        registrationFee = newFee;
    }

    /// @notice Set the fee charged on `update()`. May be zero for free updates.
    function setUpdateFee(uint256 newFee) external onlyOwner {
        emit UpdateFeeUpdated(updateFee, newFee);
        updateFee = newFee;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    /**
     * @notice Replace the fee token. Takes effect immediately.
     * @dev To avoid a race between callers who approved the old token and this
     * change taking effect, pause the contract (`pause()`) before calling
     * `setFeeToken`, update approvals, then `unpause()`.
     */
    function setFeeToken(IERC20 newToken) external onlyOwner {
        if (address(newToken) == address(0)) revert ZeroAddress();
        emit FeeTokenUpdated(address(feeToken), address(newToken));
        feeToken = newToken;
    }

    function setIdentityRegistry(address newRegistry) external onlyOwner {
        emit IdentityRegistryUpdated(identityRegistry, newRegistry);
        identityRegistry = newRegistry; // 0 allowed (unset)
    }

    /**
     * @notice Rescue tokens accidentally sent directly to this contract.
     * @dev The registry does not intentionally hold tokens (fees go straight to
     * `feeRecipient`). This recovers any stuck ERC-20 tokens.
     */
    function ownerWithdraw(IERC20 tkn, uint256 amount) external onlyOwner {
        tkn.safeTransfer(owner(), amount);
    }

    // ------------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------------

    /// @dev Pulls `registrationFee` from the caller to `feeRecipient`.
    function _collectFee() private {
        uint256 fee = registrationFee;
        if (fee == 0) return;
        feeToken.safeTransferFrom(msg.sender, feeRecipient, fee);
        emit RegistrationFeePaid(msg.sender, feeRecipient, fee);
    }

    /// @dev Pulls `updateFee` from the caller to `feeRecipient` (may be 0 = free).
    function _collectUpdateFee() private {
        uint256 fee = updateFee;
        if (fee == 0) return;
        feeToken.safeTransferFrom(msg.sender, feeRecipient, fee);
        emit RegistrationFeePaid(msg.sender, feeRecipient, fee);
    }

    /// @dev Validates string field lengths to prevent spam registrations.
    function _validateInput(ServiceInput calldata input) private pure {
        if (bytes(input.name).length > MAX_NAME_LEN) revert StringTooLong("name");
        if (bytes(input.description).length > MAX_DESC_LEN) revert StringTooLong("description");
        if (bytes(input.tags).length > MAX_TAGS_LEN) revert StringTooLong("tags");
        if (bytes(input.endpoint).length > MAX_ENDPOINT_LEN) revert StringTooLong("endpoint");
        if (bytes(input.pricePerRequest).length > MAX_PRICE_LEN) revert StringTooLong("pricePerRequest");
    }

    /// @dev Swap-and-pop removal from the enumeration array.
    function _removeKey(bytes32 key) private {
        uint256 idx1 = _keyIndex[key]; // 1-based
        uint256 lastIdx = _serviceKeys.length; // 1-based count
        if (idx1 != lastIdx) {
            bytes32 lastKey = _serviceKeys[lastIdx - 1];
            _serviceKeys[idx1 - 1] = lastKey;
            _keyIndex[lastKey] = idx1;
        }
        _serviceKeys.pop();
        delete _keyIndex[key];
    }
}
