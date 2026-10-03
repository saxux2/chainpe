import {
  createWalletClient,
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  parseUnits,
  type Address,
  type Hex
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getUsdcAddress, normalizeKey } from '@chainpe/sdk'
import type { PaymentNetwork } from '@/types.js'
import { chainFor, publicClientFor, rpcUrlFor } from '@/clients.js'

// ─── Tokens ──────────────────────────────────────────────────────────────────

export interface SwapToken {
  symbol: string
  address: Address
  decimals: number
  /** Native ETH (sent as msg.value / received unwrapped). */
  native?: boolean
}

const NATIVE_PLACEHOLDER: Address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

const MAINNET_TOKENS: Record<string, SwapToken> = {
  ETH: {
    symbol: 'ETH',
    address: NATIVE_PLACEHOLDER,
    decimals: 18,
    native: true
  },
  USDC: {
    symbol: 'USDC',
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    decimals: 6
  },
  USDT0: {
    symbol: 'USDT0',
    address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    decimals: 6
  },
  WETH: {
    symbol: 'WETH',
    address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    decimals: 18
  },
  ARB: {
    symbol: 'ARB',
    address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
    decimals: 18
  },
  WBTC: {
    symbol: 'WBTC',
    address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    decimals: 8
  }
}

// Arbitrum Sepolia: only USDC/WETH has real Uniswap v3 liquidity.
const SEPOLIA_WETH: Address = '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73'
const SEPOLIA_TOKENS: Record<string, SwapToken> = {
  ETH: { symbol: 'ETH', address: SEPOLIA_WETH, decimals: 18, native: true },
  USDC: {
    symbol: 'USDC',
    address: getUsdcAddress('arbitrum-sepolia'),
    decimals: 6
  },
  WETH: { symbol: 'WETH', address: SEPOLIA_WETH, decimals: 18 }
}

const ALIASES: Record<string, string> = {
  ARBITRUM: 'ARB',
  USDT: 'USDT0',
  BTC: 'WBTC'
}

export function swapTokens(network: PaymentNetwork): Record<string, SwapToken> {
  return network === 'arbitrum' ? MAINNET_TOKENS : SEPOLIA_TOKENS
}

export function resolveSwapToken(
  network: PaymentNetwork,
  symbol: string
): SwapToken {
  const upper = symbol.trim().toUpperCase()
  const key = ALIASES[upper] ?? upper
  const token = swapTokens(network)[key]
  if (token) return token
  const supported = Object.keys(swapTokens(network)).join(', ')
  if (network !== 'arbitrum' && MAINNET_TOKENS[key]) {
    throw new Error(
      `${key} has no market on Arbitrum Sepolia (testnet). Supported here: ${supported}. ` +
        `On Arbitrum One (NETWORK=arbitrum) ${key} swaps route through the KyberSwap aggregator.`
    )
  }
  throw new Error(
    `Unknown token "${symbol}". Supported on ${network}: ${supported}`
  )
}

// ─── Quote / result types ────────────────────────────────────────────────────

export interface SwapQuote {
  network: PaymentNetwork
  venue: 'Uniswap v3' | 'KyberSwap'
  from: SwapToken
  to: SwapToken
  amountIn: bigint
  amountOut: bigint
  /** Value of the input in USD (USDC-equivalent on testnet), for the swap cap. */
  amountInUsd: number
  route: string[]
  /** Uniswap fee tier used (testnet only). */
  feeTier?: number
  gasUsd?: number
  /** True when the output is a spot-price estimate rather than a simulation. */
  estimated: boolean
  /** Opaque data needed to build the swap transaction. */
  raw?: unknown
}

export interface SwapResult {
  txHash: Hex
  approvalTxHash?: Hex
  amountIn: bigint
  expectedOut: bigint
  minOut: bigint
  status: 'success' | 'reverted'
}

// ─── Uniswap v3 (Arbitrum Sepolia) ───────────────────────────────────────────

const UNI_FACTORY: Address = '0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e'
const UNI_ROUTER: Address = '0x101F443B4d1b059569D643917553c771E1b9663E' // SwapRouter02
const FEE_TIERS = [500, 3000, 10000] as const
/** SwapRouter02 sentinel: keep output in the router (to unwrap WETH after). */
const ADDRESS_THIS: Address = '0x0000000000000000000000000000000000000002'

const factoryAbi = parseAbi([
  'function getPool(address,address,uint24) view returns (address)'
])
const poolAbi = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() view returns (uint128)',
  'function token0() view returns (address)'
])
const routerAbi = parseAbi([
  'struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }',
  'function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[])'
])

const Q192 = 2n ** 192n

/** Spot output for `amountIn` through a pool, after the pool fee. */
export function spotAmountOut(
  amountIn: bigint,
  sqrtPriceX96: bigint,
  inputIsToken0: boolean,
  fee: number
): bigint {
  const afterFee = (amountIn * BigInt(1_000_000 - fee)) / 1_000_000n
  const p = sqrtPriceX96 * sqrtPriceX96
  return inputIsToken0 ? (afterFee * p) / Q192 : (afterFee * Q192) / p
}

async function uniswapQuote(
  network: PaymentNetwork,
  from: SwapToken,
  to: SwapToken,
  amountIn: bigint
): Promise<SwapQuote> {
  const pub = publicClientFor(network)
  const pools = await Promise.all(
    FEE_TIERS.map(async fee => {
      const pool = await pub.readContract({
        address: UNI_FACTORY,
        abi: factoryAbi,
        functionName: 'getPool',
        args: [from.address, to.address, fee]
      })
      if (BigInt(pool) === 0n) return null
      const [slot0, liquidity, token0] = await Promise.all([
        pub.readContract({
          address: pool,
          abi: poolAbi,
          functionName: 'slot0'
        }),
        pub.readContract({
          address: pool,
          abi: poolAbi,
          functionName: 'liquidity'
        }),
        pub.readContract({
          address: pool,
          abi: poolAbi,
          functionName: 'token0'
        })
      ])
      return { fee, pool, sqrtPriceX96: slot0[0], liquidity, token0 }
    })
  )
  // The deepest in-range pool gives the most reliable price; thin tiers on
  // testnet often sit at absurd prices.
  const best = pools
    .filter(p => p !== null && p.liquidity > 0n)
    .sort((a, b) => (b!.liquidity > a!.liquidity ? 1 : -1))[0]
  if (!best) {
    throw new Error(
      `No Uniswap v3 liquidity for ${from.symbol}/${to.symbol} on ${network}`
    )
  }

  const inputIsToken0 = getAddress(best.token0) === getAddress(from.address)
  const amountOut = spotAmountOut(
    amountIn,
    best.sqrtPriceX96,
    inputIsToken0,
    best.fee
  )
  const usdcIn = from.symbol === 'USDC'
  const amountInUsd = Number(
    formatUnits(
      usdcIn ? amountIn : amountOut,
      usdcIn ? from.decimals : to.decimals
    )
  )

  return {
    network,
    venue: 'Uniswap v3',
    from,
    to,
    amountIn,
    amountOut,
    amountInUsd,
    route: [`Uniswap v3 ${from.symbol}/${to.symbol} ${best.fee / 10_000}%`],
    feeTier: best.fee,
    estimated: true
  }
}

function uniswapCalldata(
  quote: SwapQuote,
  recipient: Address,
  minOut: bigint
): Hex {
  const swap = encodeFunctionData({
    abi: routerAbi,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: quote.from.address,
        tokenOut: quote.to.address,
        fee: quote.feeTier!,
        recipient: quote.to.native ? ADDRESS_THIS : recipient,
        amountIn: quote.amountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n
      }
    ]
  })
  const calls: Hex[] = [swap]
  if (quote.to.native) {
    calls.push(
      encodeFunctionData({
        abi: routerAbi,
        functionName: 'unwrapWETH9',
        args: [minOut, recipient]
      })
    )
  }
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
  return encodeFunctionData({
    abi: routerAbi,
    functionName: 'multicall',
    args: [deadline, calls]
  })
}

// ─── KyberSwap aggregator (Arbitrum One) ─────────────────────────────────────

const KYBER_API = 'https://aggregator-api.kyberswap.com/arbitrum/api/v1'
const KYBER_CLIENT_ID = 'chainpe-wallet'
/** MetaAggregationRouterV2 — the only router the wallet will send funds to. */
const KYBER_ROUTER: Address = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5'

interface KyberRouteSummary {
  amountOut: string
  amountInUsd: string
  gasUsd: string
  route: { exchange: string }[][]
}

async function kyberQuote(
  network: PaymentNetwork,
  from: SwapToken,
  to: SwapToken,
  amountIn: bigint
): Promise<SwapQuote> {
  const url =
    `${KYBER_API}/routes?tokenIn=${from.address}&tokenOut=${to.address}` +
    `&amountIn=${amountIn}`
  const r = await fetch(url, {
    headers: { Accept: 'application/json', 'x-client-id': KYBER_CLIENT_ID }
  })
  const body = (await r.json().catch(() => ({}))) as {
    code?: number
    message?: string
    data?: { routeSummary?: KyberRouteSummary; routerAddress?: string }
  }
  const rs = body.data?.routeSummary
  if (!r.ok || body.code !== 0 || !rs) {
    throw new Error(`KyberSwap quote failed: ${body.message ?? r.status}`)
  }
  return {
    network,
    venue: 'KyberSwap',
    from,
    to,
    amountIn,
    amountOut: BigInt(rs.amountOut),
    amountInUsd: Number(rs.amountInUsd),
    gasUsd: Number(rs.gasUsd),
    route: [...new Set(rs.route.flat().map(h => h.exchange))],
    estimated: false,
    raw: rs
  }
}

async function kyberBuild(
  quote: SwapQuote,
  sender: Address,
  slippageBps: number
): Promise<{ to: Address; data: Hex; value: bigint; amountOut: bigint }> {
  const r = await fetch(`${KYBER_API}/route/build`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-client-id': KYBER_CLIENT_ID
    },
    body: JSON.stringify({
      routeSummary: quote.raw,
      sender,
      recipient: sender,
      slippageTolerance: slippageBps
    })
  })
  const body = (await r.json().catch(() => ({}))) as {
    code?: number
    message?: string
    data?: {
      data: Hex
      routerAddress: string
      amountOut: string
      transactionValue?: string
    }
  }
  if (!r.ok || body.code !== 0 || !body.data) {
    throw new Error(`KyberSwap build failed: ${body.message ?? r.status}`)
  }
  const router = getAddress(body.data.routerAddress)
  if (router !== KYBER_ROUTER) {
    throw new Error(
      `KyberSwap returned an unexpected router ${router}; refusing to swap`
    )
  }
  return {
    to: router,
    data: body.data.data,
    value: BigInt(body.data.transactionValue ?? '0'),
    amountOut: BigInt(body.data.amountOut)
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getSwapQuote(
  network: PaymentNetwork,
  fromSymbol: string,
  toSymbol: string,
  amount: string
): Promise<SwapQuote> {
  const from = resolveSwapToken(network, fromSymbol)
  const to = resolveSwapToken(network, toSymbol)
  if (from.address === to.address) {
    throw new Error(
      from.native || to.native
        ? 'ETH ⇄ WETH is a wrap/unwrap, not a swap'
        : `Cannot swap ${from.symbol} to itself`
    )
  }
  const amountIn = parseUnits(amount, from.decimals)
  if (amountIn <= 0n) throw new Error('Amount must be greater than 0')
  return network === 'arbitrum'
    ? kyberQuote(network, from, to, amountIn)
    : uniswapQuote(network, from, to, amountIn)
}

export function applySlippage(amount: bigint, slippagePct: number): bigint {
  const bps = BigInt(Math.round(slippagePct * 100))
  return (amount * (10_000n - bps)) / 10_000n
}

export async function executeSwap(
  quote: SwapQuote,
  privateKey: string,
  slippagePct: number
): Promise<SwapResult> {
  const { network, from } = quote
  const account = privateKeyToAccount(normalizeKey(privateKey))
  const pub = publicClientFor(network)
  const wallet = createWalletClient({
    account,
    chain: chainFor(network),
    transport: http(rpcUrlFor(network))
  })

  // Balance check up front gives a clearer error than a reverted tx.
  const balance = from.native
    ? await pub.getBalance({ address: account.address })
    : await pub.readContract({
        address: from.address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address]
      })
  if (balance < quote.amountIn) {
    throw new Error(
      `Insufficient ${from.symbol}: have ${formatUnits(balance, from.decimals)}, ` +
        `need ${formatUnits(quote.amountIn, from.decimals)}`
    )
  }

  let to: Address
  let data: Hex
  let value: bigint
  let expectedOut: bigint
  let minOut: bigint

  if (quote.venue === 'KyberSwap') {
    const built = await kyberBuild(
      quote,
      account.address,
      Math.round(slippagePct * 100)
    )
    to = built.to
    data = built.data
    value = built.value
    expectedOut = built.amountOut
    minOut = applySlippage(expectedOut, slippagePct)
  } else {
    to = UNI_ROUTER
    value = from.native ? quote.amountIn : 0n
    expectedOut = quote.amountOut
    minOut = applySlippage(expectedOut, slippagePct)
  }

  let approvalTxHash: Hex | undefined
  if (!from.native) {
    const allowance = await pub.readContract({
      address: from.address,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account.address, to]
    })
    if (allowance < quote.amountIn) {
      // Exact-amount approval: the router never holds an open allowance.
      approvalTxHash = await wallet.writeContract({
        address: from.address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [to, quote.amountIn]
      })
      await pub.waitForTransactionReceipt({ hash: approvalTxHash })
    }
  }

  if (quote.venue === 'Uniswap v3') {
    // The quote is a spot estimate; simulate the real swap to get the exact
    // output, and refuse if price impact eats past the slippage tolerance.
    const sim = await pub.call({
      account: account.address,
      to,
      value,
      data: uniswapCalldata(quote, account.address, 0n)
    })
    const results = decodeFunctionResult({
      abi: routerAbi,
      functionName: 'multicall',
      data: sim.data!
    })
    const simulatedOut = decodeFunctionResult({
      abi: routerAbi,
      functionName: 'exactInputSingle',
      data: results[0]!
    })
    if (simulatedOut < minOut) {
      throw new Error(
        `Price impact too high: simulated ${formatUnits(simulatedOut, quote.to.decimals)} ` +
          `${quote.to.symbol}, minimum ${formatUnits(minOut, quote.to.decimals)} ` +
          `at ${slippagePct}% slippage. Try a smaller amount or higher slippagePct.`
      )
    }
    expectedOut = simulatedOut
    minOut = applySlippage(simulatedOut, slippagePct)
    data = uniswapCalldata(quote, account.address, minOut)
  }

  const txHash = await wallet.sendTransaction({ to, data: data!, value })
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash })

  return {
    txHash,
    approvalTxHash,
    amountIn: quote.amountIn,
    expectedOut,
    minOut,
    status: receipt.status
  }
}
