import { mkdtempSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  findSocketYmlSync,
  overrideCachedConfig,
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
          "data": "Change applied but not persisted; current config is overridden through env var or flag",
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
        await fs.rm(tmpDir, { force: true, recursive: true })
      }
    })
  })
})
