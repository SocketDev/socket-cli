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
  overrideCachedConfig,
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
  })
})
