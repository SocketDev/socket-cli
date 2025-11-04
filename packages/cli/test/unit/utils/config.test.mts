import { mkdtempSync, promises as fs, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { safeMkdirSync } from '@socketsecurity/lib/fs'

import {
  findSocketYmlSync,
  overrideCachedConfig,
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
        await fs.rm(tmpDir, { force: true, recursive: true })
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
