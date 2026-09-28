import { describe, it, expect, afterEach } from 'vitest'
import { getX402Network, getUsdcAddress, rpcUrlFor } from '../src/clients.js'

describe('network helpers', () => {
  afterEach(() => {
    delete process.env.ARBITRUM_RPC_URL
  })

  describe('getX402Network', () => {
    it('maps arbitrum to the CAIP-2 id eip155:42161', () => {
      expect(getX402Network('arbitrum')).toBe('eip155:42161')
    })
    it('maps arbitrum-sepolia to eip155:421614', () => {
      expect(getX402Network('arbitrum-sepolia')).toBe('eip155:421614')
    })
  })

  describe('getUsdcAddress', () => {
    it('returns Circle native USDC on Arbitrum One', () => {
      expect(getUsdcAddress('arbitrum')).toBe(
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
      )
    })
    it('returns Circle USDC on Arbitrum Sepolia', () => {
      expect(getUsdcAddress('arbitrum-sepolia')).toBe(
        '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'
      )
    })
  })

  describe('rpcUrlFor', () => {
    it('returns the public Arbitrum Sepolia RPC', () => {
      expect(rpcUrlFor('arbitrum-sepolia')).toContain('sepolia-rollup.arbitrum.io')
    })
    it('honors the ARBITRUM_RPC_URL override', () => {
      process.env.ARBITRUM_RPC_URL = 'https://rpc.example/arb'
      expect(rpcUrlFor('arbitrum')).toBe('https://rpc.example/arb')
    })
  })
})
