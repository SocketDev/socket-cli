/**
 * Unit tests for `findSocketYmlSync`.
 *
 * Purpose: Tests locating and parsing socket.yml while walking up the
 * directory tree.
 *
 * Testing Approach: Uses temporary config files.
 *
 * Related Files: - util/config.mts (implementation)
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { safeDelete, safeMkdirSync } from '@socketsecurity/lib-stable/fs/safe'

import { findSocketYmlSync } from '../../../src/util/config.mts'

describe('util/config', () => {
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

    it('returns parse error when socket.yml has invalid YAML (lines 222-228)', async () => {
      // Write a socket.yml with garbage YAML content that fails to parse.
      const tmpDir = path.resolve(
        mkdtempSync(path.join(os.tmpdir(), 'socket-test-')),
      )
      const socketYmlPath = path.join(tmpDir, 'socket.yml')
      const nestedDir = path.join(tmpDir, 'deep', 'nested')

      try {
        safeMkdirSync(nestedDir, { recursive: true })
        // Garbage with conflicting YAML mapping types — parseSocketConfig
        // expects an object schema, this will throw.
        writeFileSync(
          socketYmlPath,
          'version: not-a-version\n  invalid: ::: garbage\n!!!:\n  -- bad',
          'utf8',
        )

        const result = findSocketYmlSync(nestedDir)
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.message).toContain('unable to parse')
        }
      } finally {
        await safeDelete(tmpDir, { recursive: true })
      }
    })
  })
})
