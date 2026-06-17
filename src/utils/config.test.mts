import {
  promises as fs,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  findSocketYmlSync,
  isConfigFromFlag,
  overrideCachedConfig,
  overrideConfigApiToken,
  resetConfigForTesting,
  updateConfigValue,
} from './config.mts'
import { testPath } from '../../test/utils.mts'

const fixtureBaseDir = path.join(testPath, 'fixtures/utils/config')

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
          "data": "The active config is read-only because it was fully overridden by the --config flag, SOCKET_CLI_CONFIG, or SOCKET_CLI_NO_API_TOKEN. Remove the override to save changes to disk.",
          "message": "Config key 'defaultOrg' was updated",
          "ok": true,
        }
      `)
    })

    it('should warn for invalid key', () => {
      expect(
        updateConfigValue(
          // @ts-ignore
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

  describe('read-only state', () => {
    it('does not mark the config read-only when only the API token is overridden via env', () => {
      // A token from SOCKET_CLI_API_TOKEN / SOCKET_SECURITY_API_TOKEN overrides
      // auth only; unrelated keys must still be persistable.
      resetConfigForTesting()
      overrideConfigApiToken('sktsec_faketoken')
      expect(isConfigFromFlag()).toBe(false)
    })

    it('marks the config read-only when fully overridden via --config / SOCKET_CLI_CONFIG', () => {
      resetConfigForTesting()
      overrideCachedConfig({})
      expect(isConfigFromFlag()).toBe(true)
    })

    it('marks the config read-only when no token is forced (SOCKET_CLI_NO_API_TOKEN)', () => {
      resetConfigForTesting()
      overrideConfigApiToken(undefined)
      expect(isConfigFromFlag()).toBe(true)
    })
  })

  describe('findSocketYmlSync', () => {
    it('should find socket.yml when walking up directory tree', () => {
      // This test verifies that findSocketYmlSync correctly walks up the directory
      // tree and finds socket.yml at the repository root.
      const result = findSocketYmlSync(path.join(fixtureBaseDir, 'nonexistent'))

      // The result should be ok and find the root socket.yml.
      expect(result.ok).toBe(true)
      expect(result.data).toBeDefined()
      expect(result.data?.parsed).toBeDefined()
      expect(result.data?.path).toContain('socket.yml')
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
      await fs.mkdir(isolatedDir, { recursive: true })

      try {
        const result = findSocketYmlSync(isolatedDir)

        // The result should be ok but with undefined data.
        expect(result.ok).toBe(true)
        expect(result.data).toBe(undefined)
      } finally {
        // Clean up the temporary directory.
        rmSync(tmpDir, { force: true, recursive: true })
      }
    })
  })
})
