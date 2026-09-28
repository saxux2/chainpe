---
id: common-issues
title: Common Issues
sidebar_position: 2
---

# Common Issues

## 1. 402 not resolving

**Symptom:** `cp.fetch()` still returns `402`, or throws "payment signed but the server could not settle".

**Causes and fixes:**

- The payer has too little USDC on that network: check with `cp.balance()` and top up (testnet: [faucet.circle.com](https://faucet.circle.com), Arbitrum Sepolia).
- The client and server are on different networks: the SDK error says `server accepts [eip155:42161] but wallet is on arbitrum-sepolia (eip155:421614).` Use the matching `network`.
- The provider's facilitators are unreachable: run the proxy with `chainpe start -v` to see facilitator errors. Add another facilitator to `facilitators`, or point at your own with `--facilitator-url`.
- On Arbitrum Sepolia, Coinbase CDP isn't available; the proxy uses PayAI. On Arbitrum One, CDP needs `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`, otherwise PayAI is used.

```bash
# Settle in-process with your own gas key (no external facilitator)
chainpe start --facilitator 0xYOUR_GAS_PRIVATE_KEY

# Or use a specific facilitator
chainpe start --facilitator-url https://your-facilitator.example.com
```

---

## 2. Insufficient USDC balance

**Symptom:** Payment fails with a balance error after the 402 is issued.

**Fixes:**
- Check your balance: `chainpe status` (after `chainpe init`) or `cp.balance()`.
- Testnet: get Arbitrum Sepolia USDC from [faucet.circle.com](https://faucet.circle.com).
- Mainnet: send native USDC (`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`) on Arbitrum One — not bridged USDC.e.
- x402 payments need no approval (EIP-3009). For `register()`, you need the registration fee in USDC and a little ETH for gas; the CLI approves the fee for you.

```ts
const cp = new ChainPe({ privateKey, network: 'arbitrum-sepolia' })
const { usdc, eth } = await cp.balance()
console.log('USDC:', usdc, 'ETH:', eth)
```

---

## 3. Service not found

**Symptom:** `cp.discover()` returns nothing, or indexer `/services` shows no results.

**Fixes:**
- Registry results need a registry address: set `CHAINPE_REGISTRY_ADDRESS` (or `registryAddress`) for the network.
- Confirm the service is registered: `chainpe list`.
- Bazaar results need a query or tags; Coinbase lists a resource only after its first payment settled through CDP, on Arbitrum One.
- The indexer may lag: compare `lastIndexedBlock` to `chainHead` on its `/health`.

---

## 4. PolicyVault spending limit exceeded

**Symptom:** `PolicyVaultClient.relaySpend()` throws with `"over per-call cap"`, `"over daily cap"`, or `"over total budget"`.

**Fixes:**
- Use `previewSpend()` to check before signing:
  ```ts
  const [ok, reason] = await publicClient.readContract({
    address: vaultAddress, abi: PolicyVaultAbi,
    functionName: 'previewSpend',
    args: [owner, to, amountAtomic]
  })
  if (!ok) console.error('Would fail:', reason)
  ```
- Check remaining budget: `vault.dailyRemaining(owner)` and `vault.budgetRemaining(owner)`
- Increase the cap by calling `setPolicy()` again (resets `totalSpent`)
- Deposit more USDC if `balanceOf[owner]` is insufficient

---

## 5. Gas estimation failures

**Symptom:** `eth_estimateGas` reverts when calling `register()` or `spend()`.

**Fixes:**
- The most common cause is a missing USDC approval. For `register()`, approve the registry for `registrationFee()` (1 USDC by default); for PolicyVault `deposit()`, approve the vault for the deposit amount.
- Check the wallet has ETH for gas on that network.
- Don't use Hardhat's well-known test keys on a live network: some have EIP-7702 delegations on Arbitrum One, and their signatures fail verification.

---

## 6. Self-hosted facilitator low on gas

**Symptom:** The facilitator's `/health` shows `"status": "degraded"` with `"warning": "low_gas"`, or settlements fail.

**Cause:** The gas key's ETH balance on one network is below 0.002 ETH.

**Fix:**
- Send ETH to the facilitator address on the listed network(s)
- Check live balances at `/status`

```bash
curl https://<your-facilitator>/status
```

---

## 7. Indexer showing stale data

**Symptom:** A newly registered service does not appear in the indexer API.

**Cause:** The indexer polls on-chain events (every 5 s by default).

**Fixes:**
- Wait one or two polling cycles
- Check the indexer's sync status: `GET /health` shows `lastIndexedBlock` vs `chainHead`
- Make sure `START_BLOCK` is at or before the registry's deploy block
- Use `chainpe list`, which reads the contract directly

---

## 8. Reputation shows as unverified

**Symptom:** `getReputation()` returns `verified: false`, or the indexer's `unverifiedCount` is high.

**Fixes:**
- Without `CHAINPE_INDEXER_URL` / `indexerUrl`, the SDK reads the raw on-chain summary, which is always unverified.
- Reviews only verify with a proof of payment: pass `payment: { txHash, payTo }` to `giveFeedback`, or use `autoFeedback`, which attaches it.
- The payment must be a transfer from the reviewer to the service's `payTo` on the same chain, and each payment backs only one review.

---

## 9. npm publish failures

**Symptom:** `npm publish` fails with "You do not have permission" or "Package already exists".

**Fixes:**
- Ensure you are logged in: `npm login` with the account that owns the `@chainpe` scope
- If the version already exists, bump the version in the package's `package.json`
- Build before publishing: `npm run build` in the package directory (tsup outputs to `dist/`)
- Check the `files` field in `package.json` includes `dist/`

```bash
cd packages/chainpe-sdk
npm run build
npm publish --access public
```
