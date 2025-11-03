import { describe, expect, it } from 'vitest'

import {
  getPublicApiToken,
  getVisibleTokenPrefix,
  hasDefaultApiToken,
} from '../../../../src/sdk.mts'

describe('SDK Utilities', () => {
  describe('getPublicApiToken', () => {
    it('returns a token value', () => {
      const token = getPublicApiToken()
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(0)
    })
  })

  describe('getVisibleTokenPrefix', () => {
    it('handles when no token is set', () => {
      // This will return empty string or actual prefix depending on env.
      const prefix = getVisibleTokenPrefix()
      expect(typeof prefix).toBe('string')
    })
  })

  describe('hasDefaultApiToken', () => {
    it('returns a boolean value', () => {
      const hasToken = hasDefaultApiToken()
      expect(typeof hasToken).toBe('boolean')
    })
  })
})
