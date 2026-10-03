/**
 * Test ARB market on Arbitrum Sepolia, where real ARB has no liquidity.
 *
 * Deploys TestARB (tARB), opens a Uniswap v3 USDC/tARB 0.3% pool at the live
 * ARB price (CoinGecko), and seeds it with a concentrated position: a narrow
 * USDC band just below the price (for selling tARB) and plenty of tARB above it
 * (for buying), so a 1 USDC buy moves the price well under 1%.
 *
 *   node e2e/testnet/tarb-pool.mjs [--usdc 6]
 *
 * The deployer key pays gas and provides liquidity; the provider wallet tops
 * up the deployer's USDC if needed. Re-running reuses the token and pool from
 * .phase6/tarb.json and just adds another position.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createWalletClient,
  http,
  parseAbi,
  parseUnits,
  formatUnits,
  erc20Abi,
  getAddress,
  maxUint256
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { publicClientFor, chainFor, rpcUrlFor, NETWORKS } from '@chainpe/sdk'
import { NETWORK, ROOT, LOG_DIR, key, assertSepolia, record, arbiscanTx } from './lib.mjs'

const FACTORY = '0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e'
const POSITION_MANAGER = '0x6b2937Bde17889EDCf8fbD8dE31C3C2a70Bc4d65'
const FEE = 3000
const TICK_SPACING = 60
const SUPPLY = parseUnits('100000000', 18)
// Position range in USD per tARB, relative to the live price.
const RANGE_LOW = 0.98
const RANGE_HIGH = 3

const STATE = resolve(LOG_DIR, 'tarb.json')
const args = process.argv.slice(2)
const usdcArg = args.includes('--usdc') ? args[args.indexOf('--usdc') + 1] : '6'
const USDC_LIQ = parseUnits(usdcArg, 6)

const pub = publicClientFor(NETWORK)
await assertSepolia(pub)
const USDC = NETWORKS[NETWORK].usdc
const transport = http(rpcUrlFor(NETWORK))
const deployer = createWalletClient({ account: privateKeyToAccount(key('DEPLOYER_PRIVATE_KEY')), chain: chainFor(NETWORK), transport })
const provider = createWalletClient({ account: privateKeyToAccount(key('PROVIDER_PRIVATE_KEY')), chain: chainFor(NETWORK), transport })
const me = deployer.account.address

const send = async (label, p) => {
  const hash = await p
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`${label} reverted: ${arbiscanTx(hash)}`)
  console.log(`  ✓ ${label}  ${arbiscanTx(hash)}`)
  return r
}

// ── 1. Live price ────────────────────────────────────────────────────────────
const cg = await (await fetch('https://api.coingecko.com/api/v3/simple/price?ids=arbitrum&vs_currencies=usd')).json()
const PRICE = Number(cg?.arbitrum?.usd)
if (!(PRICE > 0)) throw new Error('Could not read the ARB price from CoinGecko')
console.log(`ARB price: $${PRICE}  (1 USDC = ${(1 / PRICE).toFixed(4)} ARB)`)

// ── 2. Token ─────────────────────────────────────────────────────────────────
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}
if (!state.token) {
  const art = JSON.parse(readFileSync(resolve(ROOT, 'contracts/artifacts/contracts/mocks/TestARB.sol/TestARB.json'), 'utf8'))
  const r = await send('deploy TestARB', deployer.deployContract({ abi: art.abi, bytecode: art.bytecode, args: [me, SUPPLY] }))
  state.token = getAddress(r.contractAddress)
  writeFileSync(STATE, JSON.stringify(state, null, 2))
  record({ step: 'tarb', what: 'deploy TestARB', tx: r.transactionHash, address: state.token })
}
const TARB = state.token
console.log(`tARB: ${TARB}`)

// ── 3. USDC for liquidity ────────────────────────────────────────────────────
const usdcBal = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [me] })
if (usdcBal < USDC_LIQ) {
  await send(`provider → deployer ${formatUnits(USDC_LIQ - usdcBal, 6)} USDC`,
    provider.writeContract({ address: USDC, abi: erc20Abi, functionName: 'transfer', args: [me, USDC_LIQ - usdcBal] }))
}

// ── 4. Pool ──────────────────────────────────────────────────────────────────
const [token0, token1] = BigInt(USDC) < BigInt(TARB) ? [USDC, TARB] : [TARB, USDC]
const usdcIs0 = token0 === USDC
// Raw price = token1 per token0 in base units; tARB has 18 decimals, USDC 6.
const rawPrice = (usdPerArb) => (usdcIs0 ? 1e12 / usdPerArb : usdPerArb / 1e12)
const toTick = (raw) => Math.log(raw) / Math.log(1.0001)
const sqrtX96 = BigInt(Math.floor(Math.sqrt(rawPrice(PRICE)) * 2 ** 96))

const npmAbi = parseAbi([
  'function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) payable returns (address pool)',
  'struct MintParams { address token0; address token1; uint24 fee; int24 tickLower; int24 tickUpper; uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min; address recipient; uint256 deadline; }',
  'function mint(MintParams params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'
])
const factoryAbi = parseAbi(['function getPool(address,address,uint24) view returns (address)'])
const poolAbi = parseAbi(['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)'])

let pool = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'getPool', args: [token0, token1, FEE] })
if (BigInt(pool) === 0n) {
  await send('create + initialize USDC/tARB 0.3% pool',
    deployer.writeContract({ address: POSITION_MANAGER, abi: npmAbi, functionName: 'createAndInitializePoolIfNecessary', args: [token0, token1, FEE, sqrtX96] }))
  pool = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'getPool', args: [token0, token1, FEE] })
}
state.pool = getAddress(pool)
writeFileSync(STATE, JSON.stringify(state, null, 2))
const [, currentTick] = await pub.readContract({ address: pool, abi: poolAbi, functionName: 'slot0' })
console.log(`pool: ${pool}  (tick ${currentTick})`)

// ── 5. Liquidity ─────────────────────────────────────────────────────────────
// Ticks for the USD range; inverted when USDC is token0 (price falls as ARB rises).
const a = toTick(rawPrice(PRICE * RANGE_LOW))
const b = toTick(rawPrice(PRICE * RANGE_HIGH))
const tickLower = Math.floor(Math.min(a, b) / TICK_SPACING) * TICK_SPACING
const tickUpper = Math.ceil(Math.max(a, b) / TICK_SPACING) * TICK_SPACING
if (!(tickLower < currentTick && currentTick < tickUpper)) {
  throw new Error(`Pool tick ${currentTick} is outside the new range [${tickLower}, ${tickUpper}] — pool price has drifted from the market`)
}

for (const t of [USDC, TARB]) {
  const allowance = await pub.readContract({ address: t, abi: erc20Abi, functionName: 'allowance', args: [me, POSITION_MANAGER] })
  if (allowance < (t === USDC ? USDC_LIQ : SUPPLY / 2n)) {
    await send(`approve ${t === USDC ? 'USDC' : 'tARB'}`,
      deployer.writeContract({ address: t, abi: erc20Abi, functionName: 'approve', args: [POSITION_MANAGER, maxUint256] }))
  }
}

const TARB_MAX = parseUnits('1000000', 18) // the USDC side binds; this is just a ceiling
const [amount0Desired, amount1Desired] = usdcIs0 ? [USDC_LIQ, TARB_MAX] : [TARB_MAX, USDC_LIQ]
const mintArgs = {
  token0, token1, fee: FEE, tickLower, tickUpper,
  amount0Desired, amount1Desired, amount0Min: 0n, amount1Min: 0n,
  recipient: me, deadline: BigInt(Math.floor(Date.now() / 1000) + 600)
}
const { result } = await pub.simulateContract({ account: deployer.account, address: POSITION_MANAGER, abi: npmAbi, functionName: 'mint', args: [mintArgs] })
const [tokenId, liquidity, used0, used1] = result
const r = await send('mint liquidity position', deployer.writeContract({ address: POSITION_MANAGER, abi: npmAbi, functionName: 'mint', args: [mintArgs] }))
const [usedUsdc, usedTarb] = usdcIs0 ? [used0, used1] : [used1, used0]
console.log(`  position #${tokenId}: ${formatUnits(usedUsdc, 6)} USDC + ${formatUnits(usedTarb, 18)} tARB  (liquidity ${liquidity})`)

state.positions = [...(state.positions ?? []), { tokenId: tokenId.toString(), tickLower, tickUpper, usdc: formatUnits(usedUsdc, 6), tarb: formatUnits(usedTarb, 18), tx: r.transactionHash }]
writeFileSync(STATE, JSON.stringify(state, null, 2))
record({ step: 'tarb', what: 'USDC/tARB liquidity', tx: r.transactionHash, pool: state.pool, tokenId: tokenId.toString() })

console.log(`\nDone. tARB ${TARB}  ·  pool ${state.pool}`)
