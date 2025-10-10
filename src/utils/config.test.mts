import path from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  findSocketYmlSync,
  getConfigValue,
  getConfigValueOrUndef,
  getSupportedConfigKeys,
  isSensitiveConfigKey,
  isSupportedConfigKey,
  overrideCachedConfig,
  updateConfigValue,
} from './config.mts'
import { testPath } from '../../test/utils.mts'

const fixtureBaseDir = path.join(testPath, 'fixtures/utils/config')

describe('utils/config', () => {
  beforeEach(() => {
    overrideCachedConfig('{}')
  })

  describe('updateConfigValue', () => {
    it('should return object for applying a change', () => {
      expect(
        updateConfigValue('defaultOrg', 'fake_test_org'),
      ).toMatchInlineSnapshot(`
        {
          "data": "Change applied but not persisted; current config is overridden through env var or flag",
          "message": "Config key 'defaultOrg' was updated",
          "ok": true,
        }
      `)
    })

    it('should warn for invalid key', () => {
      expect(
        updateConfigValue(
          // @ts-expect-error
          'nawthiswontwork',
          'fake_test_org',
        ),
      ).toMatchInlineSnapshot(`
        {
          "data": undefined,
          "message": "Invalid config key: nawthiswontwork",
          "ok": false,
        }
      `)
    })

    it('should update apiToken', () => {
      const result = updateConfigValue('apiToken', 'test-token')
      expect(result.ok).toBe(true)
      expect(result.message).toContain('apiToken')
    })

    it('should update apiBaseUrl', () => {
      const result = updateConfigValue('apiBaseUrl', 'https://api.test.com')
      expect(result.ok).toBe(true)
    })

    it('should update apiProxy', () => {
      const result = updateConfigValue('apiProxy', 'http://proxy.test.com')
      expect(result.ok).toBe(true)
    })

    it('should handle org alias for defaultOrg', () => {
      const result = updateConfigValue('org', 'test-org')
      expect(result.ok).toBe(true)
    })

    it('should handle enforcedOrgs array', () => {
      const result = updateConfigValue('enforcedOrgs', ['org1', 'org2'])
      expect(result.ok).toBe(true)
    })
  })

  describe('getConfigValue', () => {
    it('should get config value', () => {
      overrideCachedConfig('{"defaultOrg":"test-org"}')
      const result = getConfigValue('defaultOrg')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe('test-org')
      }
    })

    it('should return undefined for unset value', () => {
      const result = getConfigValue('defaultOrg')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBeUndefined()
      }
    })

    it('should normalize org to defaultOrg', () => {
      overrideCachedConfig('{"defaultOrg":"my-org"}')
      const result = getConfigValue('org')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe('my-org')
      }
    })

    it('should handle invalid key', () => {
      const result = getConfigValue('invalidKey' as any)
      expect(result.ok).toBe(false)
    })

    it('should get apiToken', () => {
      overrideCachedConfig('{"apiToken":"test-token"}')
      const result = getConfigValue('apiToken')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe('test-token')
      }
    })

    it('should get apiBaseUrl', () => {
      overrideCachedConfig('{"apiBaseUrl":"https://api.test.com"}')
      const result = getConfigValue('apiBaseUrl')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe('https://api.test.com')
      }
    })
  })

  describe('getConfigValueOrUndef', () => {
    it('should return value when available', () => {
      overrideCachedConfig('{"defaultOrg":"test-org"}')
      expect(getConfigValueOrUndef('defaultOrg')).toBe('test-org')
    })

    it('should return undefined when not available', () => {
      expect(getConfigValueOrUndef('defaultOrg')).toBeUndefined()
    })

    it('should return undefined for invalid key', () => {
      expect(getConfigValueOrUndef('invalidKey' as any)).toBeUndefined()
    })

    it('should handle apiToken', () => {
      overrideCachedConfig('{"apiToken":"token123"}')
      expect(getConfigValueOrUndef('apiToken')).toBe('token123')
    })

    it('should handle enforcedOrgs', () => {
      overrideCachedConfig('{"enforcedOrgs":["org1","org2"]}')
      const result = getConfigValueOrUndef('enforcedOrgs')
      expect(result).toEqual(['org1', 'org2'])
    })
  })

  describe('overrideCachedConfig', () => {
    it('should override cached config', () => {
      overrideCachedConfig('{"defaultOrg":"override-org"}')
      expect(getConfigValueOrUndef('defaultOrg')).toBe('override-org')
    })

    it('should override multiple values', () => {
      overrideCachedConfig('{"defaultOrg":"test-org","apiToken":"test-token"}')
      expect(getConfigValueOrUndef('defaultOrg')).toBe('test-org')
      expect(getConfigValueOrUndef('apiToken')).toBe('test-token')
    })

    it('should clear previous config', () => {
      overrideCachedConfig('{"defaultOrg":"first"}')
      overrideCachedConfig('{"apiToken":"token"}')
      expect(getConfigValueOrUndef('defaultOrg')).toBeUndefined()
      expect(getConfigValueOrUndef('apiToken')).toBe('token')
    })
  })

  describe('isSupportedConfigKey', () => {
    it('should return true for valid keys', () => {
      expect(isSupportedConfigKey('apiToken')).toBe(true)
      expect(isSupportedConfigKey('defaultOrg')).toBe(true)
      expect(isSupportedConfigKey('apiBaseUrl')).toBe(true)
      expect(isSupportedConfigKey('apiProxy')).toBe(true)
      expect(isSupportedConfigKey('org')).toBe(true)
      expect(isSupportedConfigKey('enforcedOrgs')).toBe(true)
    })

    it('should return false for invalid keys', () => {
      expect(isSupportedConfigKey('invalidKey')).toBe(false)
      expect(isSupportedConfigKey('notAKey' as any)).toBe(false)
    })
  })

  describe('isSensitiveConfigKey', () => {
    it('should return true for sensitive keys', () => {
      expect(isSensitiveConfigKey('apiToken')).toBe(true)
    })

    it('should return false for non-sensitive keys', () => {
      expect(isSensitiveConfigKey('defaultOrg')).toBe(false)
      expect(isSensitiveConfigKey('apiBaseUrl')).toBe(false)
      expect(isSensitiveConfigKey('apiProxy')).toBe(false)
    })
  })

  describe('getSupportedConfigKeys', () => {
    it('should return array of supported keys', () => {
      const keys = getSupportedConfigKeys()
      expect(Array.isArray(keys)).toBe(true)
      expect(keys.length).toBeGreaterThan(0)
    })

    it('should include expected keys', () => {
      const keys = getSupportedConfigKeys()
      expect(keys).toContain('apiToken')
      expect(keys).toContain('defaultOrg')
      expect(keys).toContain('apiBaseUrl')
    })

    it('should be sorted', () => {
      const keys = getSupportedConfigKeys()
      const sorted = [...keys].sort()
      expect(keys).toEqual(sorted)
    })
  })

  describe('findSocketYmlSync', () => {
    it('should handle when no socket.yml exists (regression test for .parsed access)', () => {
      // This test ensures we don't regress on the error:
      // "Cannot read properties of undefined (reading 'parsed')"
      // when socketYmlResult.data is undefined.
      const result = findSocketYmlSync(path.join(fixtureBaseDir, 'nonexistent'))

      // The result should be ok but with undefined data.
      expect(result.ok).toBe(true)
      expect(result.data).toBe(undefined)
    })

    it('should search up directory tree', () => {
      // Even if called from a nested directory, it should search upward
      const result = findSocketYmlSync(
        path.join(fixtureBaseDir, 'nested', 'deep'),
      )
      expect(result.ok).toBe(true)
    })

    it('should return ok result when no file found', () => {
      const result = findSocketYmlSync('/nonexistent/path')
      expect(result.ok).toBe(true)
      expect(result.data).toBeUndefined()
    })
  })
})
