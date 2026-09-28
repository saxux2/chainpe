import { describe, it, expect } from 'vitest'
import { getToken, findTokenByAddress, parseNetwork } from '../src/networks.js'

describe('token table', () => {
  it('has USDC on both networks and USDT0 on Arbitrum One only', () => {
    expect(getToken('arbitrum', 'USDC').address).toBe('0xaf88d065e77c8cC2239327C5EDb3A432268e5831')
    expect(getToken('arbitrum', 'USDT0')).toMatchObject({ eip712Name: 'USD₮0', eip712Version: '1', transferMethod: 'eip3009' })
    expect(getToken('arbitrum-sepolia', 'USDC').address).toBe('0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d')
    expect(() => getToken('arbitrum-sepolia', 'USDT0')).toThrow(/not supported on arbitrum-sepolia/)
  })

  it('finds tokens by address case-insensitively', () => {
    expect(findTokenByAddress('arbitrum', '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9')?.symbol).toBe('USDT0')
    expect(findTokenByAddress('arbitrum', '0x000000000000000000000000000000000000dEaD')).toBeUndefined()
  })
})

describe('parseNetwork', () => {
  it('rejects legacy Avalanche names', () => {
    expect(() => parseNetwork('fuji')).toThrow(/Unsupported network/)
    expect(parseNetwork(undefined)).toBe('arbitrum')
  })
})
