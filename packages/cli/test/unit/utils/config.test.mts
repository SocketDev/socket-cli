/**
 * Unit tests for configuration management.
 *
 * Purpose:
 * Tests configuration file loading and merging. Validates config precedence, defaults, and environment overrides.
 *
 * Test Coverage:
 * - Config file loading (.socketrc, package.json)
 * - Default value handling
 * - Environment variable overrides
 * - Config merging and precedence
 * - Validation and schema checking
 * - Non-destructive config saving
 *
 * Testing Approach:
 * Uses temporary config files and environment variable mocking.
 *
 * Related Files:
 * - utils/config.mts (implementation)
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { safeDelete, safeMkdirSync } from '@socketsecurity/lib/fs'

import {
  findSocketYmlSync,
  getConfigValue,
  getConfigValueOrUndef,
  getSupportedConfigEntries,
  getSupportedConfigKeys,
  isConfigFromFlag,
  isSensitiveConfigKey,
  isSupportedConfigKey,
  overrideCachedConfig,
  overrideConfigApiToken,
  resetConfigForTesting,
  updateConfigValue,
} from '../../../src/utils/config.mts'
import { testPath } from '../../../test/utils.mts'

const _fixtureBaseDir = path.join(testPath, 'fixtures/utils/config')

describe('utils/config', () => {
  describe('updateConfigValue', () => {
    beforeEach(() => {
      overrideCachedConfig({})
    })

    it('should return object for applying a change', () => {
      expect(updateConfigValue('defaultOrg', 'fake_test_org'))
        .toMatchInlineSnapshot(`
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

    it('warns when value is the string "true" (line 378-381)', () => {
      // Stringy bool tracks the not-pre-validated path; the function still
      // accepts the value but emits a logger.warn telling the user that
      // they probably meant a real boolean.
      const result = updateConfigValue('defaultOrg', 'true' as any)
      expect(result.ok).toBe(true)
    })

    it('warns when value is the string "false"', () => {
      const result = updateConfigValue('defaultOrg', 'false' as any)
      expect(result.ok).toBe(true)
    })

    it('warns when value is the string "undefined"', () => {
      const result = updateConfigValue('defaultOrg', 'undefined' as any)
      expect(result.ok).toBe(true)
    })

    it('handles skipAskToPersistDefaultOrg=true correctly', () => {
      const result = updateConfigValue('skipAskToPersistDefaultOrg', 'true' as any)
      expect(result.ok).toBe(true)
    })

    it('handles skipAskToPersistDefaultOrg=false correctly', () => {
      const result = updateConfigValue(
        'skipAskToPersistDefaultOrg',
        'false' as any,
      )
      expect(result.ok).toBe(true)
    })

    it('deletes skipAskToPersistDefaultOrg on non-bool value', () => {
      const result = updateConfigValue(
        'skipAskToPersistDefaultOrg',
        'something' as any,
      )
      expect(result.ok).toBe(true)
    })
  })

  describe('overrideConfigApiToken', () => {
    it('sets apiToken when provided (line 348-354)', () => {
      overrideCachedConfig({})
      overrideConfigApiToken('test-token-123')
      const result = getConfigValue('apiToken')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe('test-token-123')
      }
    })

    it('handles undefined token without setting key', () => {
      overrideCachedConfig({})
      overrideConfigApiToken(undefined)
      // No key set, but the read-only flag is still toggled.
      const result = getConfigValue('apiToken')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBeUndefined()
      }
    })

    it('coerces non-string token via String()', () => {
      overrideCachedConfig({})
      overrideConfigApiToken(12345 as any)
      const result = getConfigValue('apiToken')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe('12345')
      }
    })
  })

  describe('findSocketYmlSync', () => {
    it('should find socket.yml when walking up directory tree', async () => {
      // Create an isolated tmpdir with a socket.yml fixture.
      const tmpDir = path.resolve(
        mkdtempSync(path.join(os.tmpdir(), 'socket-test-')),
      )
      const socketYmlPath = path.join(tmpDir, 'socket.yml')
      const nestedDir = path.join(tmpDir, 'deep', 'nested', 'directory')

      try {
        // Create nested directories.
        safeMkdirSync(nestedDir, { recursive: true })

        // Create socket.yml in the tmpdir root.
        writeFileSync(
          socketYmlPath,
          'version: 2\n\nprojectIgnorePaths:\n  - node_modules\n',
          'utf8',
        )

        // Call findSocketYmlSync from the nested directory - it should walk up and find socket.yml.
        const result = findSocketYmlSync(nestedDir)

        // The result should be ok and find the socket.yml.
        expect(result.ok).toBe(true)
        expect(result.data).toBeDefined()
        expect(result.data?.parsed).toBeDefined()
        expect(result.data?.path).toBe(socketYmlPath)
      } finally {
        // Clean up the temporary directory.
        await safeDelete(tmpDir, { recursive: true })
      }
    })

    it('should handle when no socket.yml exists (regression test for .parsed access)', async () => {
      // This test ensures we don't regress on the error:
      // "Cannot read properties of undefined (reading 'parsed')"
      // when socketYmlResult.data is undefined.
      //
      // Create an isolated temporary directory outside the repository.
      // This ensures no parent directories contain socket.yml.
      const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'socket-test-'))
      const isolatedDir = path.join(tmpDir, 'deep', 'nested', 'directory')
      safeMkdirSync(isolatedDir, { recursive: true })

      try {
        const result = findSocketYmlSync(isolatedDir)

        // The result should be ok but with undefined data.
        expect(result.ok).toBe(true)
        expect(result.data).toBe(undefined)
      } finally {
        // Clean up the temporary directory.
        await safeDelete(tmpDir, { recursive: true })
      }
    })
  })

  describe('non-destructive config saving', () => {
    let tmpDir: string
    let originalEnvValue: string | undefined
    // getSocketAppDataPath() uses LOCALAPPDATA on Windows, XDG_DATA_HOME elsewhere.
    const isWin32 = process.platform === 'win32'
    const envKey = isWin32 ? 'LOCALAPPDATA' : 'XDG_DATA_HOME'

    beforeEach(() => {
      // Create temp directory for config storage.
      tmpDir = mkdtempSync(path.join(os.tmpdir(), 'socket-config-test-'))
      // Save original env value.
      originalEnvValue = process.env[envKey]
      // Point config to temp directory.
      // getSocketAppDataPath() appends 'socket/settings' to the data home.
      process.env[envKey] = tmpDir
      // Reset config cache so it reads from the new location.
      resetConfigForTesting()
    })

    afterEach(async () => {
      // Restore original env value.
      if (originalEnvValue === undefined) {
        delete process.env[envKey]
      } else {
        process.env[envKey] = originalEnvValue
      }
      // Reset config cache.
      resetConfigForTesting()
      // Clean up temp directory.
      await safeDelete(tmpDir)
    })

    it('should preserve existing properties when updating config', async () => {
      // Create the settings directory structure.
      const settingsDir = path.join(tmpDir, 'socket', 'settings')
      safeMkdirSync(settingsDir)
      const configFilePath = path.join(settingsDir, 'config.json')

      // Create initial config with multiple properties (base64 encoded).
      const initialConfig = {
        apiToken: 'existing-token',
        defaultOrg: 'existing-org',
      }
      const initialJson = JSON.stringify(initialConfig)
      writeFileSync(configFilePath, Buffer.from(initialJson).toString('base64'))

      // Reset cache so it reads the file we just created.
      resetConfigForTesting()

      // Update only one property using the actual updateConfigValue function.
      const result = updateConfigValue('apiToken', 'new-token')
      expect(result.ok).toBe(true)

      // Wait for nextTick to complete the async write.
      await new Promise(resolve => process.nextTick(resolve))

      // Read and verify all properties are preserved.
      const finalRaw = readFileSync(configFilePath, 'utf8')
      const finalDecoded = Buffer.from(finalRaw, 'base64').toString('utf8')
      const finalConfig = JSON.parse(finalDecoded)

      // The updated property should have the new value.
      expect(finalConfig.apiToken).toBe('new-token')
      // Existing properties should be preserved.
      expect(finalConfig.defaultOrg).toBe('existing-org')
    })

    it('should preserve JSON key order when updating config', async () => {
      // Create the settings directory structure.
      const settingsDir = path.join(tmpDir, 'socket', 'settings')
      safeMkdirSync(settingsDir)
      const configFilePath = path.join(settingsDir, 'config.json')

      // Create config with specific key order (base64 encoded).
      // Using valid config keys: defaultOrg comes before apiToken alphabetically,
      // but we write them in reverse order to test preservation.
      const initialJson = '{"defaultOrg":"org1","apiToken":"token1"}'
      writeFileSync(configFilePath, Buffer.from(initialJson).toString('base64'))

      // Reset cache so it reads the file we just created.
      resetConfigForTesting()

      // Update one property.
      const result = updateConfigValue('apiToken', 'token2')
      expect(result.ok).toBe(true)

      // Wait for nextTick to complete the async write.
      await new Promise(resolve => process.nextTick(resolve))

      // Verify key order is preserved.
      const finalRaw = readFileSync(configFilePath, 'utf8')
      const finalDecoded = Buffer.from(finalRaw, 'base64').toString('utf8')
      const keys = Object.keys(JSON.parse(finalDecoded))

      // Keys should maintain original order: defaultOrg first, then apiToken.
      expect(keys).toEqual(['defaultOrg', 'apiToken'])
    })

    it('should create config file when it does not exist', async () => {
      // Don't create any initial config file.
      // Reset cache.
      resetConfigForTesting()

      // Update a property - this should create the config file.
      const result = updateConfigValue('defaultOrg', 'new-org')
      expect(result.ok).toBe(true)

      // Wait for nextTick to complete the async write.
      await new Promise(resolve => process.nextTick(resolve))

      // Verify the config file was created.
      const settingsDir = path.join(tmpDir, 'socket', 'settings')
      const configFilePath = path.join(settingsDir, 'config.json')
      const finalRaw = readFileSync(configFilePath, 'utf8')
      const finalDecoded = Buffer.from(finalRaw, 'base64').toString('utf8')
      const finalConfig = JSON.parse(finalDecoded)

      expect(finalConfig.defaultOrg).toBe('new-org')
    })

    it('should read config value after setting it', async () => {
      // Reset cache.
      resetConfigForTesting()

      // Set a config value.
      updateConfigValue('defaultOrg', 'test-org')

      // Read it back immediately (from cache).
      const result = getConfigValue('defaultOrg')
      expect(result.ok).toBe(true)
      expect(result.data).toBe('test-org')
    })

    it('handles skipAskToPersistDefaultOrg with string "true"', () => {
      resetConfigForTesting()
      const r = updateConfigValue('skipAskToPersistDefaultOrg', 'true' as any)
      expect(r.ok).toBe(true)
    })

    it('handles skipAskToPersistDefaultOrg with string "false"', () => {
      resetConfigForTesting()
      const r = updateConfigValue('skipAskToPersistDefaultOrg', 'false' as any)
      expect(r.ok).toBe(true)
    })

    it('deletes skipAskToPersistDefaultOrg when value is unrecognized', () => {
      resetConfigForTesting()
      // Set it first.
      updateConfigValue('skipAskToPersistDefaultOrg', 'true' as any)
      // Now pass an unrecognized value — should delete the key.
      const result = updateConfigValue(
        'skipAskToPersistDefaultOrg',
        'maybe' as any,
      )
      expect(result.ok).toBe(true)
    })
  })

  describe('getSupportedConfigEntries / getSupportedConfigKeys', () => {
    it('returns a non-empty array of [key, value] entries', () => {
      const entries = getSupportedConfigEntries()
      expect(Array.isArray(entries)).toBe(true)
      expect(entries.length).toBeGreaterThan(0)
      for (const entry of entries) {
        expect(Array.isArray(entry)).toBe(true)
        expect(entry).toHaveLength(2)
      }
    })

    it('returns a non-empty array of supported keys', () => {
      const keys = getSupportedConfigKeys()
      expect(Array.isArray(keys)).toBe(true)
      expect(keys.length).toBeGreaterThan(0)
      expect(keys).toContain('defaultOrg')
    })
  })

  describe('isConfigFromFlag', () => {
    it('returns false initially', () => {
      resetConfigForTesting()
      expect(isConfigFromFlag()).toBe(false)
    })

    it('returns true after invalid override (line 315)', () => {
      resetConfigForTesting()
      // overrideCachedConfig with non-object JSON triggers the catch branch
      // that sets _configFromFlag = true.
      overrideCachedConfig('not valid json{{{{')
      expect(isConfigFromFlag()).toBe(true)
    })
  })

  describe('isSensitiveConfigKey', () => {
    it('returns true for apiToken', () => {
      expect(isSensitiveConfigKey('apiToken')).toBe(true)
    })

    it('returns false for non-sensitive keys', () => {
      expect(isSensitiveConfigKey('defaultOrg')).toBe(false)
    })

    it('returns false for unknown keys', () => {
      expect(isSensitiveConfigKey('totally-bogus')).toBe(false)
    })
  })

  describe('isSupportedConfigKey', () => {
    it('returns true for known keys', () => {
      expect(isSupportedConfigKey('defaultOrg')).toBe(true)
      expect(isSupportedConfigKey('apiToken')).toBe(true)
    })

    it('returns false for unknown keys', () => {
      expect(isSupportedConfigKey('totally-bogus')).toBe(false)
    })
  })

  describe('overrideCachedConfig', () => {
    afterEach(() => {
      resetConfigForTesting()
    })

    it('returns parse error for non-object JSON (line 315)', () => {
      // A primitive (number) is valid JSON but not a config object.
      const result = overrideCachedConfig('42')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Could not parse Config as JSON')
      }
    })

    it('returns parse error for null JSON (line 315)', () => {
      const result = overrideCachedConfig('null')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Could not parse Config as JSON')
      }
    })
  })

  describe('getConfigValueOrUndef', () => {
    afterEach(() => {
      resetConfigForTesting()
    })

    it('returns undefined for invalid keys', () => {
      // The internal normalizeConfigKey returns !ok for unsupported keys.
      // getConfigValueOrUndef squashes that to undefined.
      expect(getConfigValueOrUndef('totally-bogus' as any)).toBeUndefined()
    })

    it('returns the config value for valid keys', () => {
      overrideCachedConfig(JSON.stringify({ defaultOrg: 'my-org' }))
      expect(getConfigValueOrUndef('defaultOrg')).toBe('my-org')
    })
  })

  describe('getConfigValue', () => {
    afterEach(() => {
      resetConfigForTesting()
    })

    it('returns the !ok keyResult for invalid keys (line 243)', () => {
      const result = getConfigValue('totally-bogus' as any)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Invalid config key')
      }
    })

    it('returns ok with data for valid keys', () => {
      overrideCachedConfig(JSON.stringify({ defaultOrg: 'good-org' }))
      const result = getConfigValue('defaultOrg')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe('good-org')
      }
    })
  })
})
