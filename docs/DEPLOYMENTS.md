# ChainPe — Deployed Contracts

## Arbitrum

ChainPe uses the **canonical ERC-8004 registries** (same vanity addresses on every
chain) and deploys only its own ChainPeRegistry and PolicyVault.

### Canonical contracts (not deployed by ChainPe)

| Contract | Arbitrum One (42161) | Arbitrum Sepolia (421614) |
|---|---|---|
| ERC-8004 IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| USDC (Circle, native) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| USDT0 | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | — |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | same |

### Arbitrum Sepolia (testnet)

Deployed 2026-09-28 by `0xfa59D77cDc586A28E3a2c5487DF90a59AABF7105` (`contracts/deployments/arbitrumSepolia*.json`).

| Contract | Address | Proxy? | Explorer |
|---|---|---|---|
| ChainPeRegistry (proxy) | `0x3f1fC54d8A5AD97Cf72a9A46a813640630dcB783` | UUPS | [explorer](https://sepolia.arbiscan.io/address/0x3f1fC54d8A5AD97Cf72a9A46a813640630dcB783) |
| ChainPeRegistry (impl) | `0xB33e475e80334CB8404F59E10B3bfB547186A699` | — | [explorer](https://sepolia.arbiscan.io/address/0xB33e475e80334CB8404F59E10B3bfB547186A699) |
| PolicyVault (proxy) | `0x9F363Ed70c49701Af50638fDd7849a164295b416` | UUPS | [explorer](https://sepolia.arbiscan.io/address/0x9F363Ed70c49701Af50638fDd7849a164295b416) |
| PolicyVault (impl) | `0xa7Dba8896c840B33041cdeEfB9E63B50EcC83F3E` | — | [explorer](https://sepolia.arbiscan.io/address/0xa7Dba8896c840B33041cdeEfB9E63B50EcC83F3E) |

- Deploy block (indexer `START_BLOCK`): registry `313653262`, vault `313653321`
- Registration fee: 1 USDC (`1000000`), paid to the deployer
- Owner: the deployer EOA (testnet only; not verified on Arbiscan yet — needs `ETHERSCAN_API_KEY`)

Validation transactions (Phase 6, 2026-09-28; scripts in `e2e/testnet/`):

| Step | What | Tx |
|---|---|---|
| 6.1 | ERC-8004 identity for the provider (agent #249, canonical Identity Registry) | [`0x7436d16b…`](https://sepolia.arbiscan.io/tx/0x7436d16b885faa4e1a4605473d676159b3e660db8b545fb59abc4a83d92fb7f2) |
| 6.1 | Registered "ChainPe Phase6 Weather" (0.01 USDC, `http://localhost:4021`) | [`0x9d36de7f…`](https://sepolia.arbiscan.io/tx/0x9d36de7fb653cd3374623fd5f96863b7e1683c89312d94b6c77e1590e9117157) |
| 6.2 | SDK paid call, settled by PayAI | [`0x4c1312aa…`](https://sepolia.arbiscan.io/tx/0x4c1312aaf14073a11b25da3da363f806e611a84b34d715e2d7c3fcfb86dd142d) |
| 6.3 | SDK review with proof of payment — indexer: verified | [`0xa6ee6481…`](https://sepolia.arbiscan.io/tx/0xa6ee6481f96dd1a24dc265c6815321e7be8310ba5de4a2df119a37fd444faee4) |
| 6.2 | Agent paid call (registry discovery), settled by PayAI | [`0x057f469d…`](https://sepolia.arbiscan.io/tx/0x057f469da0693b500f1cd439e19d8add74d21e7df42ce12042419e2fea853f84) |
| 6.3 | Agent review with proof of payment — indexer: verified | [`0x971d68f8…`](https://sepolia.arbiscan.io/tx/0x971d68f83714a7c3d71ea5f96b9932b2fdbef2d86f24cef64b21de154ffe7c0f) |
| 6.2 | Wallet MCP `x402_fetch` paid call from Claude Desktop, settled by PayAI | [`0x049aa8de…`](https://sepolia.arbiscan.io/tx/0x049aa8ded209c25b3abafb8428c5ce657c8cf43edffef6f982d44b61db771fbb) |
| 6.3 | Wallet review with proof of payment — indexer: verified | [`0xc58edfcd…`](https://sepolia.arbiscan.io/tx/0xc58edfcd60893f0b817042cdf60b0120ab954ac3ad1e6ef206fe026c655071a2) |
| 6.4 | SDK paid call with a dead facilitator first; PayAI settled | [`0x5c9c8dfa…`](https://sepolia.arbiscan.io/tx/0x5c9c8dfae1a8c9466b01175fffc7d70a35238b69c4a3f2fb2de1c135bbd6660f) |
| 6.4 | Its review — indexer: verified | [`0x5b95b052…`](https://sepolia.arbiscan.io/tx/0x5b95b0526a1db9612738349decd764666610a2537302f902c1efe6124560beca) |
| 6.5 | Vault: approve 2 USDC | [`0xdb5ecad8…`](https://sepolia.arbiscan.io/tx/0xdb5ecad81e65cf74e57cc70a2ec8e8a0b0da7838ce3e295b2a5f949963b62308) |
| 6.5 | Vault: deposit 2 USDC | [`0xa9f5b289…`](https://sepolia.arbiscan.io/tx/0xa9f5b289617bcb30330144c06fc8a6b296f63ef4ba4e70cee19abb553d5b0cd8) |
| 6.5 | Vault: setPolicy maxPerCall 0.5 / dailyCap 1 / totalBudget 2 | [`0x452f7ae2…`](https://sepolia.arbiscan.io/tx/0x452f7ae2ef5579ef2924acfdc92d50c216157fa6ba4eeb3a19668f46b76d0602) |
| 6.5 | Vault: relayed spend #1, 0.5 USDC (session key signs, deployer relays) | [`0xcdb6498e…`](https://sepolia.arbiscan.io/tx/0xcdb6498ef2e469b20cf5426144bc21b3d8a1d76ca2f48e98225d3ec90c8f3727) |
| 6.5 | Vault: relayed spend #2, 0.5 USDC | [`0x47944cc8…`](https://sepolia.arbiscan.io/tx/0x47944cc82e6930ae75464321e773715e642fbe6d3c5c2c2d5037d8963da1771c) |
| 6.5 | Vault: third 0.5 USDC spend rejected — `OverDailyCap` (no tx; reverts in simulation) | — |
| 6.5 | Vault: withdraw remaining 1 USDC | [`0xaf91ccad…`](https://sepolia.arbiscan.io/tx/0xaf91ccade675a69a6aa7ef6eebe8ae2c6932cb694f9ac60e3e992fced9edcb87) |

Marketplace sellers and test ARB market (2026-10-03):

| What | Address / ID | Tx |
|---|---|---|
| Arbitrum Price Agent (agent #256, `http://localhost:4503`) | `0xc7B05Fb4F550aBcd8a7bE020D197da5a5c44aDf3` | [`0x083a51b0…`](https://sepolia.arbiscan.io/tx/0x083a51b08160a8fa62e376806b4f1d7c2693f3d46230af23da31943c6e8ea9a4) |
| Arbitrum News Agent (agent #257, `http://localhost:4504`) | `0x8ab6186d056Db6611436e66431E89b0359ccAAda` | [`0xc42f9cda…`](https://sepolia.arbiscan.io/tx/0xc42f9cdabe99800f6f3ce40c66d3d40d28534853bc8a18dabe882b904fdd2af1) |
| Arbitrum DEX Agent (agent #258, `http://localhost:4506`) | `0xA1b3EF4F7bF77CF5E8acF156B6dCC6f00e067bEf` | [`0x586058c2…`](https://sepolia.arbiscan.io/tx/0x586058c25b342a6fedfaadeef0c40bdfe9268afababff663dc02836079e1670c) |
| TestARB (tARB), stand-in for ARB (`contracts/contracts/mocks/TestARB.sol`) | `0x32aFb2F080A755Da6673d43912663C7cc26F1a5D` | [`0xf7283191…`](https://sepolia.arbiscan.io/tx/0xf72831910d1e93762eb3e7f921f93bca36a1997918083f52e3f3fb47db38803b) |
| Uniswap v3 USDC/tARB 0.3% pool, seeded at $0.1974/ARB (`e2e/testnet/tarb-pool.mjs`) | `0x9a65552c544CD240D640069eFa63238234910A93` | [`0xd2d6a92c…`](https://sepolia.arbiscan.io/tx/0xd2d6a92c5b671662c6038c29e8deb9849104824af5429a8ed4c1f4c124a4c266) |
| Wallet MCP `swap_tokens` 1 USDC → 5.039 tARB | — | [`0x8325bef7…`](https://sepolia.arbiscan.io/tx/0x8325bef7eba57b2eb0189748c9b67b328586fa2088afabccbc7a14c346412d54) |

### Arbitrum One (mainnet)

Not deployed yet.

| Contract | Address | Proxy? | Explorer |
|---|---|---|---|
| ChainPeRegistry (proxy) | — | UUPS | — |
| ChainPeRegistry (impl) | — | — | — |
| PolicyVault (proxy) | — | UUPS | — |
| PolicyVault (impl) | — | — | — |
| ChainPeTimelock | — | — | — |

- Deploy block (indexer `START_BLOCK`): —
- Registration fee: —
- Owner (Safe → timelock): —

### Hosted services

| Service | URL | Notes |
|---|---|---|
| Dashboard | — | |
| Indexer API | — | `NETWORK`, `CHAINPE_REGISTRY_ADDRESS`, `START_BLOCK` |
| Facilitator (optional) | — | Providers default to Coinbase CDP / PayAI |

## Client configuration

The ERC-8004 registries need no configuration. Point clients at your registry:

```bash
# Provider CLI (~/.chainpe/config.json → registryAddress), wallet MCP, agent, SDK:
export CHAINPE_REGISTRY_ADDRESS=0x…
# Optional: payment-verified reputation
export CHAINPE_INDEXER_URL=https://…
```

Raw deployment records land in `contracts/deployments/<network>.json`,
`<network>-policyvault.json` and `<network>-timelock.json` (network names
`arbitrumSepolia` / `arbitrum`).

## Deploy runbook

**Prerequisites** (in `contracts/.env`, never committed):
- `DEPLOYER_PRIVATE_KEY` — a fresh EOA with a little ETH on the target network.
  Never use Hardhat's well-known test keys on a live network.
- `OWNER_ADDRESS` — a Safe multisig (https://app.safe.global, Arbitrum network).
  Required on Arbitrum One; the script refuses a deployer-owned mainnet deploy.
- `ETHERSCAN_API_KEY` — an Etherscan v2 key (covers Arbiscan).
- Optional: `REGISTRATION_FEE_USDC` (default `1.0`), `FEE_RECIPIENT` (default deployer).

```bash
cd contracts

# 0. Check keys and RPC, then compile and test
npm run check-keys
npx hardhat test

# 1. ChainPeRegistry (UUPS proxy; fee token = native USDC, identity = canonical ERC-8004)
OWNER_ADDRESS=0xYourSafe npm run deploy:sepolia        # or deploy:mainnet

# 2. PolicyVault (UUPS proxy)
OWNER_ADDRESS=0xYourSafe npm run deploy:policyvault:sepolia

# 3. Mainnet only: timelock, then hand ownership to it through the Safe
npm run deploy:timelock:mainnet
SAFE_ADDRESS=0xYourSafe npm run transfer-ownership:mainnet
# then accept ownership from the Safe (app.safe.global → acceptOwnership())

# 4. Verify on Arbiscan
npm run verify:sepolia                                  # or verify:mainnet

# 5. Mainnet checks
npm run preflight:mainnet   # before deploying
npm run postcheck:mainnet   # after deploying

# 6. Optional demo listings
npm run register-demo:sepolia
```

Then record the addresses and deploy block above, and start the indexer with
`START_BLOCK` set to the ChainPeRegistry deploy block.

---

## Archived (Avalanche, 2026-06)

ChainPe ran on Avalanche C-Chain until the move to Arbitrum. These contracts are
no longer used by any ChainPe package. Raw records:
`contracts/deployments/archive-avalanche/`.

### Avalanche C-Chain (mainnet, chainId 43114)

Deployed 2026-06-17. Deployer / owner: `0x3b8a312fac101E7163F9701457d8Dc46cE8fd30a`.

| Contract | Address | Proxy? | Explorer |
|---|---|---|---|
| ChainPeRegistry (proxy) | `0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E` | UUPS | [Snowtrace](https://snowtrace.io/address/0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E#code) |
| ChainPeRegistry (impl) | `0xd3A9136F8D7F0DcEb2F97f70A7164743466D5E62` | — | [Snowtrace](https://snowtrace.io/address/0xd3A9136F8D7F0DcEb2F97f70A7164743466D5E62) |
| PolicyVault (proxy) | `0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8` | UUPS | [Snowtrace](https://snowtrace.io/address/0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8) |
| PolicyVault (impl) | `0x4cED17f828375C6852B3651b214bE0F0171f4391` | — | [Snowtrace](https://snowtrace.io/address/0x4cED17f828375C6852B3651b214bE0F0171f4391) |
| ERC-8004 IdentityRegistry (proxy, self-deployed) | `0xB1330d7B1b083ba689C7f56bDf667F1F528a3195` | UUPS | [Snowtrace](https://snowtrace.io/address/0xB1330d7B1b083ba689C7f56bDf667F1F528a3195) |
| ERC-8004 ReputationRegistry (proxy, self-deployed) | `0xfe7Df66e6BFbd3A76B68dF26b9312E6c85a38543` | UUPS | [Snowtrace](https://snowtrace.io/address/0xfe7Df66e6BFbd3A76B68dF26b9312E6c85a38543) |
| ERC-8004 ValidationRegistry (proxy, self-deployed) | `0x91477bD9211448a85eFb16ea858432a85d89b833` | UUPS | [Snowtrace](https://snowtrace.io/address/0x91477bD9211448a85eFb16ea858432a85d89b833) |
| ChainPeICMReceiver (removed) | `0xc8aBD919F597C46dA889e76704F69A2809cd6D33` | no | [Snowtrace](https://snowtrace.io/address/0xc8aBD919F597C46dA889e76704F69A2809cd6D33) |
| ChainPeICMSender (removed) | `0x097D7D4B46CB894142a72E91c3b8F8b5834255dF` | no | [Snowtrace](https://snowtrace.io/address/0x097D7D4B46CB894142a72E91c3b8F8b5834255dF) |

ChainPeRegistry config: fee token Circle USDC `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`;
registration fee **1 USDC** (`1000000` atomic, per `archive-avalanche/avalanche.json`;
earlier versions of this file said 0.1 USDC, which was wrong).

Hosted services on Railway (Avalanche era): dashboard
`chainpe-dashboard-production-dbd1.up.railway.app`, indexer
`chainpe-indexer-production-f791.up.railway.app`, facilitator
`chainpe-facilitator-production-000a.up.railway.app`.

Legacy Fuji testnet records: `archive-avalanche/fuji.json`, `archive-avalanche/fuji-erc8004.json`.
