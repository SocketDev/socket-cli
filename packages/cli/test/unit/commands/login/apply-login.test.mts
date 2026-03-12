/**
 * Unit tests for login apply utilities.
 *
 * Purpose:
 * Tests the applyLogin function that updates CLI configuration.
 *
 * Test Coverage:
 * - Config value updates
 * - Token storage
 * - Enforced orgs storage
 *
 * Related Files:
 * - commands/login/apply-login.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
const mockUpdateConfigValue = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/config.mts', () => ({
  updateConfigValue: mockUpdateConfigValue,
}))

import { applyLogin } from '../../../../src/commands/login/apply-login.mts'

describe('apply-login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('applyLogin', () => {
    it('updates all config values', () => {
      applyLogin('test-token', ['org1', 'org2'], 'https://api.example.com', 'http://proxy')

      expect(mockUpdateConfigValue).toHaveBeenCalledTimes(4)
      expect(mockUpdateConfigValue).toHaveBeenCalledWith('enforcedOrgs', ['org1', 'org2'])
      expect(mockUpdateConfigValue).toHaveBeenCalledWith('apiToken', 'test-token')
      expect(mockUpdateConfigValue).toHaveBeenCalledWith('apiBaseUrl', 'https://api.example.com')
      expect(mockUpdateConfigValue).toHaveBeenCalledWith('apiProxy', 'http://proxy')
    })

    it('handles undefined apiBaseUrl', () => {
      applyLogin('test-token', ['org1'], undefined, undefined)

      expect(mockUpdateConfigValue).toHaveBeenCalledWith('apiBaseUrl', undefined)
      expect(mockUpdateConfigValue).toHaveBeenCalledWith('apiProxy', undefined)
    })

    it('handles empty enforced orgs', () => {
      applyLogin('test-token', [], undefined, undefined)

      expect(mockUpdateConfigValue).toHaveBeenCalledWith('enforcedOrgs', [])
    })
  })
})
