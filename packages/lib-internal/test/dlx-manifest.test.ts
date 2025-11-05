/**
 * @fileoverview Unit tests for dlx manifest utilities.
 *
 * Tests type guards and utilities for dlx (download and execute) manifest entries:
 * - isPackageEntry() validates package-type manifest entries
 * - isBinaryEntry() validates binary-type manifest entries
 * - ManifestEntry discriminated union with 'package' or 'binary' types
 * - Tests type narrowing, cache_key validation, and timestamp handling
 * - Ensures TypeScript type guards work correctly for manifest parsing
 * dlx manifests track cached npm packages and binaries for npx-like execution.
 */

import {
  isPackageEntry,
  isBinaryEntry,
  type ManifestEntry,
  type PackageDetails,
  type BinaryDetails,
} from '@socketsecurity/lib/dlx-manifest'
import { describe, expect, it } from 'vitest'

describe('dlx-manifest', () => {
  describe('isPackageEntry', () => {
    it('should return true for package entries', () => {
      const entry: ManifestEntry = {
        type: 'package',
        cache_key: 'test-package@1.0.0',
        timestamp: Date.now(),
        details: {
          installed_version: '1.0.0',
        } as PackageDetails,
      }
      expect(isPackageEntry(entry)).toBe(true)
    })

    it('should return false for binary entries', () => {
      const entry: ManifestEntry = {
        type: 'binary',
        cache_key: 'test-binary',
        timestamp: Date.now(),
        details: {
          checksum: 'abc123',
          checksum_algorithm: 'sha256',
          platform: 'linux',
          arch: 'x64',
          size: 1024,
          source: { type: 'download', url: 'https://example.com' },
        } as BinaryDetails,
      }
      expect(isPackageEntry(entry)).toBe(false)
    })
  })

  describe('isBinaryEntry', () => {
    it('should return true for binary entries', () => {
      const entry: ManifestEntry = {
        type: 'binary',
        cache_key: 'test-binary',
        timestamp: Date.now(),
        details: {
          checksum: 'abc123',
          checksum_algorithm: 'sha256',
          platform: 'linux',
          arch: 'x64',
          size: 1024,
          source: { type: 'download', url: 'https://example.com' },
        } as BinaryDetails,
      }
      expect(isBinaryEntry(entry)).toBe(true)
    })

    it('should return false for package entries', () => {
      const entry: ManifestEntry = {
        type: 'package',
        cache_key: 'test-package@1.0.0',
        timestamp: Date.now(),
        details: {
          installed_version: '1.0.0',
        } as PackageDetails,
      }
      expect(isBinaryEntry(entry)).toBe(false)
    })
  })

  describe('ManifestEntry types', () => {
    it('should support package entries with update_check', () => {
      const entry: ManifestEntry = {
        type: 'package',
        cache_key: 'test@1.0.0',
        timestamp: Date.now(),
        details: {
          installed_version: '1.0.0',
          size: 12_345,
          update_check: {
            last_check: Date.now(),
            last_notification: Date.now(),
            latest_known: '1.0.1',
          },
        } as PackageDetails,
      }
      expect(entry.type).toBe('package')
      if (isPackageEntry(entry)) {
        expect(entry.details.installed_version).toBe('1.0.0')
        expect(entry.details.update_check).toBeDefined()
      }
    })

    it('should support binary entries with all fields', () => {
      const entry: ManifestEntry = {
        type: 'binary',
        cache_key: 'binary-key',
        timestamp: Date.now(),
        details: {
          checksum: 'sha256hash',
          checksum_algorithm: 'sha256',
          platform: 'darwin',
          arch: 'arm64',
          size: 2048,
          source: {
            type: 'download',
            url: 'https://example.com/binary',
          },
        } as BinaryDetails,
      }
      expect(entry.type).toBe('binary')
      if (isBinaryEntry(entry)) {
        expect(entry.details.checksum).toBe('sha256hash')
        expect(entry.details.platform).toBe('darwin')
        expect(entry.details.arch).toBe('arm64')
      }
    })
  })

  describe('type guards', () => {
    it('should narrow types correctly with isPackageEntry', () => {
      const entry: ManifestEntry = {
        type: 'package',
        cache_key: 'test',
        timestamp: Date.now(),
        details: { installed_version: '1.0.0' } as PackageDetails,
      }

      if (isPackageEntry(entry)) {
        // TypeScript should know entry.details is PackageDetails
        expect(entry.details.installed_version).toBeDefined()
      }
    })

    it('should narrow types correctly with isBinaryEntry', () => {
      const entry: ManifestEntry = {
        type: 'binary',
        cache_key: 'test',
        timestamp: Date.now(),
        details: {
          checksum: 'abc',
          checksum_algorithm: 'sha512',
          platform: 'win32',
          arch: 'x64',
          size: 100,
          source: { type: 'download', url: 'https://test.com' },
        } as BinaryDetails,
      }

      if (isBinaryEntry(entry)) {
        // TypeScript should know entry.details is BinaryDetails
        expect(entry.details.checksum).toBeDefined()
        expect(entry.details.checksum_algorithm).toBe('sha512')
      }
    })
  })

  describe('checksum algorithms', () => {
    it('should support sha256', () => {
      const details: BinaryDetails = {
        checksum: 'abc123',
        checksum_algorithm: 'sha256',
        platform: 'linux',
        arch: 'x64',
        size: 1024,
        source: { type: 'download', url: 'https://example.com' },
      }
      expect(details.checksum_algorithm).toBe('sha256')
    })

    it('should support sha512', () => {
      const details: BinaryDetails = {
        checksum: 'def456',
        checksum_algorithm: 'sha512',
        platform: 'darwin',
        arch: 'arm64',
        size: 2048,
        source: { type: 'download', url: 'https://example.com' },
      }
      expect(details.checksum_algorithm).toBe('sha512')
    })
  })
})
