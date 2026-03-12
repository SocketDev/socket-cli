/**
 * Unit tests for config constants.
 *
 * Purpose:
 * Tests the configuration key constants for Socket CLI settings.
 *
 * Test Coverage:
 * - Config key constant values
 * - Config key naming conventions
 *
 * Related Files:
 * - constants/config.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_DEFAULT_ORG,
  CONFIG_KEY_ENFORCED_ORGS,
  CONFIG_KEY_ORG,
} from '../../../src/constants/config.mts'

describe('config constants', () => {
  describe('config key constants', () => {
    it('has CONFIG_KEY_API_BASE_URL constant', () => {
      expect(CONFIG_KEY_API_BASE_URL).toBe('apiBaseUrl')
    })

    it('has CONFIG_KEY_API_PROXY constant', () => {
      expect(CONFIG_KEY_API_PROXY).toBe('apiProxy')
    })

    it('has CONFIG_KEY_API_TOKEN constant', () => {
      expect(CONFIG_KEY_API_TOKEN).toBe('apiToken')
    })

    it('has CONFIG_KEY_DEFAULT_ORG constant', () => {
      expect(CONFIG_KEY_DEFAULT_ORG).toBe('defaultOrg')
    })

    it('has CONFIG_KEY_ENFORCED_ORGS constant', () => {
      expect(CONFIG_KEY_ENFORCED_ORGS).toBe('enforcedOrgs')
    })

    it('has CONFIG_KEY_ORG constant', () => {
      expect(CONFIG_KEY_ORG).toBe('org')
    })
  })

  describe('config key naming', () => {
    it('API-related keys start with api', () => {
      expect(CONFIG_KEY_API_BASE_URL).toMatch(/^api/)
      expect(CONFIG_KEY_API_PROXY).toMatch(/^api/)
      expect(CONFIG_KEY_API_TOKEN).toMatch(/^api/)
    })

    it('org-related keys contain Org or org', () => {
      expect(CONFIG_KEY_DEFAULT_ORG.toLowerCase()).toContain('org')
      expect(CONFIG_KEY_ENFORCED_ORGS.toLowerCase()).toContain('org')
      expect(CONFIG_KEY_ORG.toLowerCase()).toContain('org')
    })

    it('all keys use camelCase', () => {
      const keys = [
        CONFIG_KEY_API_BASE_URL,
        CONFIG_KEY_API_PROXY,
        CONFIG_KEY_API_TOKEN,
        CONFIG_KEY_DEFAULT_ORG,
        CONFIG_KEY_ENFORCED_ORGS,
        CONFIG_KEY_ORG,
      ]
      for (const key of keys) {
        // camelCase starts with lowercase and has no underscores or hyphens.
        expect(key).toMatch(/^[a-z][a-zA-Z]*$/)
      }
    })
  })
})
