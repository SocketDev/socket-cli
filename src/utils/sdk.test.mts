import { describe, expect, it } from 'vitest'

import {
  getDefaultApiBaseUrl,
  getDefaultApiToken,
  getDefaultProxyUrl,
  getPublicApiToken,
  getVisibleTokenPrefix,
  hasDefaultApiToken,
} from './sdk.mts'

describe('SDK Utilities', () => {
  describe('getDefaultApiToken', () => {
    it('returns a string or undefined', () => {
      const token = getDefaultApiToken()
      expect(token === undefined || typeof token === 'string').toBe(true)
    })

    it('does not return empty string', () => {
      const token = getDefaultApiToken()
      expect(token !== '').toBe(true)
    })
  })

  describe('getPublicApiToken', () => {
    it('returns a token value', () => {
      const token = getPublicApiToken()
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(0)
    })

    it('returns a defined token', () => {
      const token = getPublicApiToken()
      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
    })
  })

  describe('getVisibleTokenPrefix', () => {
    it('returns a string', () => {
      const prefix = getVisibleTokenPrefix()
      expect(typeof prefix).toBe('string')
    })

    it('returns a prefix of expected length or empty string', () => {
      const prefix = getVisibleTokenPrefix()
      // Should be either empty or 5 characters
      expect(prefix.length === 0 || prefix.length === 5).toBe(true)
    })
  })

  describe('hasDefaultApiToken', () => {
    it('returns a boolean value', () => {
      const hasToken = hasDefaultApiToken()
      expect(typeof hasToken).toBe('boolean')
    })

    it('matches whether getDefaultApiToken returns a value', () => {
      const hasToken = hasDefaultApiToken()
      const token = getDefaultApiToken()
      expect(hasToken).toBe(!!token)
    })
  })

  describe('getDefaultApiBaseUrl', () => {
    it('returns a string or undefined', () => {
      const baseUrl = getDefaultApiBaseUrl()
      expect(baseUrl === undefined || typeof baseUrl === 'string').toBe(true)
    })

    it('returns a valid URL if defined', () => {
      const baseUrl = getDefaultApiBaseUrl()
      if (baseUrl !== undefined) {
        expect(
          baseUrl.startsWith('http://') || baseUrl.startsWith('https://'),
        ).toBe(true)
      }
    })
  })

  describe('getDefaultProxyUrl', () => {
    it('returns a string or undefined', () => {
      const proxyUrl = getDefaultProxyUrl()
      expect(proxyUrl === undefined || typeof proxyUrl === 'string').toBe(true)
    })

    it('returns a valid URL if defined', () => {
      const proxyUrl = getDefaultProxyUrl()
      if (proxyUrl !== undefined) {
        expect(
          proxyUrl.startsWith('http://') || proxyUrl.startsWith('https://'),
        ).toBe(true)
      }
    })
  })
})
