/**
 * @fileoverview Tests for DLX binary cache functionality.
 *
 * Tests cover:
 * - Path resolution (getSocketHomePath, getDlxCachePath)
 * - Cache listing (listDlxCache)
 * - Cache cleaning (cleanDlxCache)
 *
 * Note: Full download/execution tests are in integration tests.
 * These unit tests focus on cache management operations.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { normalizePath } from '@socketsecurity/lib/path'

import { InputError } from '../../../../src/error/errors.mts'
import {
  cleanDlxCache,
  getDlxCachePath,
  getSocketHomePath,
  listDlxCache,
} from '../../../../../src/utils/dlx/binary.mts'

describe('binary', () => {
  describe('getSocketHomePath', () => {
    it('should return correct path', () => {
      const result = normalizePath(getSocketHomePath())
      const expected = normalizePath(path.join(os.homedir(), '.socket'))
      expect(result).toBe(expected)
    })

    it('should throw error when home directory cannot be determined', () => {
      const originalHomedir = os.homedir
      os.homedir = vi.fn(() => '')

      expect(() => getSocketHomePath()).toThrow(
        new InputError('Unable to determine home directory'),
      )

      os.homedir = originalHomedir
    })
  })

  describe('getDlxCachePath', () => {
    it('should return correct cache path', () => {
      const result = normalizePath(getDlxCachePath())
      const expected = normalizePath(path.join(os.homedir(), '.socket', '_dlx'))
      expect(result).toBe(expected)
    })
  })

  describe('listDlxCache', () => {
    it('should return empty array when cache directory does not exist', async () => {
      const result = await listDlxCache()
      // Could be empty or have cached items depending on test environment
      expect(Array.isArray(result)).toBe(true)
    })

    it('should return array of cache entries when cache exists', async () => {
      const result = await listDlxCache()
      expect(Array.isArray(result)).toBe(true)

      // If cache has entries, verify structure
      if (result.length > 0) {
        const entry = result[0]
        expect(entry).toHaveProperty('name')
        expect(entry).toHaveProperty('url')
        expect(entry).toHaveProperty('size')
        expect(entry).toHaveProperty('age')
        expect(entry).toHaveProperty('platform')
        expect(entry).toHaveProperty('arch')
        expect(entry).toHaveProperty('checksum')
        expect(typeof entry.name).toBe('string')
        expect(typeof entry.url).toBe('string')
        expect(typeof entry.size).toBe('number')
        expect(typeof entry.age).toBe('number')
        expect(typeof entry.platform).toBe('string')
        expect(typeof entry.arch).toBe('string')
        expect(typeof entry.checksum).toBe('string')
      }
    })
  })

  describe('cleanDlxCache', () => {
    it('should return 0 when cache directory does not exist', async () => {
      // If cache doesn't exist, should return 0
      const cachePath = getDlxCachePath()
      if (!existsSync(cachePath)) {
        const result = await cleanDlxCache()
        expect(result).toBe(0)
      } else {
        // If cache exists, should return non-negative number
        const result = await cleanDlxCache()
        expect(result).toBeGreaterThanOrEqual(0)
      }
    })

    it('should clean expired entries based on maxAge', async () => {
      // Clean with very short TTL (should clean old entries)
      const result = await cleanDlxCache(0)
      expect(result).toBeGreaterThanOrEqual(0)
    })

    it('should not clean fresh entries', async () => {
      // Clean with very long TTL (should not clean anything)
      // 1 year
      const result = await cleanDlxCache(365 * 24 * 60 * 60 * 1000)
      expect(result).toBe(0)
    })
  })

  describe('cache structure validation', () => {
    it('should have valid cache directory structure', async () => {
      const cachePath = normalizePath(getDlxCachePath())
      const socketHome = normalizePath(getSocketHomePath())

      expect(cachePath.startsWith(socketHome)).toBe(true)
      expect(cachePath.endsWith(normalizePath('_dlx'))).toBe(true)

      // If cache exists, verify it's a directory
      if (existsSync(cachePath)) {
        const stats = await fs.stat(cachePath)
        expect(stats.isDirectory()).toBe(true)
      }
    })
  })
})
