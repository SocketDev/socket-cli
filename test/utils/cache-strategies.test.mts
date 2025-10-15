/** @fileoverview Tests for intelligent caching strategies. */

import { describe, expect, it } from 'vitest'

import {
  calculateAdaptiveTtl,
  getCacheStrategy,
  getRecommendedTtl,
  isVolatileData,
  shouldWarmCache,
} from '../../../src/utils/cache-strategies.mts'

describe('getCacheStrategy', () => {
  it('should return strategy for package info', () => {
    const strategy = getCacheStrategy('/npm/@types/node/score')
    // 15 minutes
    expect(strategy.ttl).toBe(15 * 60 * 1000)
    expect(strategy.volatile).toBe(false)
  })

  it('should return strategy for package issues', () => {
    const strategy = getCacheStrategy('/npm/lodash/4.17.21/issues')
    // 5 minutes
    expect(strategy.ttl).toBe(5 * 60 * 1000)
    expect(strategy.volatile).toBe(true)
  })

  it('should return strategy for scan results', () => {
    const strategy = getCacheStrategy('/scans/abc123')
    // 2 minutes
    expect(strategy.ttl).toBe(2 * 60 * 1000)
    expect(strategy.volatile).toBe(true)
  })

  it('should return strategy for org settings', () => {
    const strategy = getCacheStrategy('/organizations/my-org/settings')
    // 30 minutes
    expect(strategy.ttl).toBe(30 * 60 * 1000)
    expect(strategy.warmOnStartup).toBe(true)
  })

  it('should return strategy for user info', () => {
    const strategy = getCacheStrategy('/users/me')
    // 1 hour
    expect(strategy.ttl).toBe(60 * 60 * 1000)
    expect(strategy.warmOnStartup).toBe(true)
  })

  it('should return default strategy for unknown path', () => {
    const strategy = getCacheStrategy('/unknown/endpoint')
    // Default 5 minutes
    expect(strategy.ttl).toBe(5 * 60 * 1000)
    expect(strategy.warmOnStartup).toBe(false)
    expect(strategy.volatile).toBe(false)
  })
})

describe('getRecommendedTtl', () => {
  it('should return longer TTL for stable data', () => {
    const ttl = getRecommendedTtl('/users/john')
    // 1 hour
    expect(ttl).toBe(60 * 60 * 1000)
  })

  it('should return shorter TTL for volatile data', () => {
    const ttl = getRecommendedTtl('/scans/xyz')
    // 2 minutes
    expect(ttl).toBe(2 * 60 * 1000)
  })

  it('should return medium TTL for package scores', () => {
    const ttl = getRecommendedTtl('/npm/react/18.2.0/score')
    // 15 minutes (matches package-info strategy)
    expect(ttl).toBe(15 * 60 * 1000)
  })
})

describe('shouldWarmCache', () => {
  it('should warm user info cache', () => {
    expect(shouldWarmCache('/users/me')).toBe(true)
  })

  it('should warm org settings cache', () => {
    expect(shouldWarmCache('/organizations/socket/settings')).toBe(true)
  })

  it('should not warm scan results', () => {
    expect(shouldWarmCache('/scans/abc')).toBe(false)
  })

  it('should not warm package info', () => {
    expect(shouldWarmCache('/npm/lodash/4.17.21/score')).toBe(false)
  })
})

describe('isVolatileData', () => {
  it('should identify scan results as volatile', () => {
    expect(isVolatileData('/scans/123')).toBe(true)
  })

  it('should identify package issues as volatile', () => {
    expect(isVolatileData('/npm/express/4.18.0/issues')).toBe(true)
  })

  it('should identify user info as stable', () => {
    expect(isVolatileData('/users/jane')).toBe(false)
  })

  it('should identify org settings as stable', () => {
    expect(isVolatileData('/organizations/acme/settings')).toBe(false)
  })

  it('should identify dependency tree as stable', () => {
    expect(isVolatileData('/dependencies/react')).toBe(false)
  })
})

describe('calculateAdaptiveTtl', () => {
  it('should keep base TTL for low access count', () => {
    // 10 minutes
    const baseTtl = 10 * 60 * 1000
    const ttl = calculateAdaptiveTtl(baseTtl, 5)
    expect(ttl).toBe(baseTtl)
  })

  it('should reduce TTL for high access count', () => {
    // 10 minutes
    const baseTtl = 10 * 60 * 1000
    const ttl = calculateAdaptiveTtl(baseTtl, 20)
    expect(ttl).toBeLessThan(baseTtl)
    // Minimum 30s
    expect(ttl).toBeGreaterThanOrEqual(30 * 1000)
  })

  it('should enforce minimum TTL', () => {
    // 1 minute
    const baseTtl = 1 * 60 * 1000
    const ttl = calculateAdaptiveTtl(baseTtl, 100)
    // Minimum 30s
    expect(ttl).toBe(30 * 1000)
  })

  it('should reduce TTL proportionally to access frequency', () => {
    // 10 minutes
    const baseTtl = 10 * 60 * 1000
    const ttl11 = calculateAdaptiveTtl(baseTtl, 11)
    const ttl15 = calculateAdaptiveTtl(baseTtl, 15)
    const ttl20 = calculateAdaptiveTtl(baseTtl, 20)

    // TTL should decrease as access count increases
    expect(ttl15).toBeLessThan(ttl11)
    expect(ttl20).toBeLessThan(ttl15)
  })

  it('should cap reduction at 50%', () => {
    // 10 minutes
    const baseTtl = 10 * 60 * 1000
    const ttl = calculateAdaptiveTtl(baseTtl, 1000)
    const minExpected = baseTtl * 0.5
    expect(ttl).toBeGreaterThanOrEqual(Math.max(30 * 1000, minExpected))
  })
})
