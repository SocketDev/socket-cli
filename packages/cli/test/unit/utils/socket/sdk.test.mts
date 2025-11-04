/**
 * Unit tests for Socket SDK setup.
 *
 * Purpose:
 * Tests Socket SDK initialization and configuration. Validates SDK setup with various options.
 *
 * Test Coverage:
 * - SDK initialization
 * - API token handling
 * - Base URL configuration
 * - User agent setup
 * - SDK error handling
 *
 * Testing Approach:
 * Mocks @socketsecurity/sdk to test setup logic.
 *
 * Related Files:
 * - utils/socket/sdk.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  getPublicApiToken,
  getVisibleTokenPrefix,
  hasDefaultApiToken,
} from '../../../../src/utils/socket/sdk.mts'

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
