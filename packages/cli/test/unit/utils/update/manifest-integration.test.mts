/**
 * @fileoverview Integration tests for unified DLX manifest.
 * Tests that both package and binary entries can coexist in the same manifest.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { UpdateStore } from '../../../../src/store.mts'

import type {
  BinaryDetails,
  PackageDetails,
} from '../../../../src/store.mts'

describe('unified manifest integration', () => {
  let testStore: UpdateStore
  let testManifestPath: string

  beforeEach(() => {
    // Create a unique test manifest path.
    testManifestPath = path.join(
      os.tmpdir(),
      `socket-cli-test-manifest-${Date.now()}.json`,
    )
    testStore = new UpdateStore({ storePath: testManifestPath })
  })

  afterEach(async () => {
    // Clean up test manifest file.
    try {
      if (existsSync(testManifestPath)) {
        await fs.unlink(testManifestPath)
      }
      if (existsSync(`${testManifestPath}.lock`)) {
        await fs.unlink(`${testManifestPath}.lock`)
      }
    } catch {
      // Ignore cleanup errors.
    }
  })

  it('should store and retrieve package entries', async () => {
    const spec = '@socketsecurity/cli@^2.0.11'
    const cacheKey = 'abc123def456'
    const details: PackageDetails = {
      installed_version: '2.0.11',
      size: 1024000,
    }

    await testStore.setPackageEntry(spec, cacheKey, details)

    const entry = testStore.getManifestEntry(spec)
    expect(entry).toBeDefined()
    expect(entry?.type).toBe('package')
    expect(entry?.cache_key).toBe(cacheKey)
    expect(entry?.details).toMatchObject(details)
  })

  it('should store and retrieve binary entries', async () => {
    const spec = 'https://example.com/binary.tar.gz:node-darwin-arm64'
    const cacheKey = 'def456abc123'
    const details: BinaryDetails = {
      checksum: 'sha256hash',
      checksum_algorithm: 'sha256',
      platform: 'darwin',
      arch: 'arm64',
      size: 2048000,
      source: {
        type: 'download',
        url: 'https://example.com/binary.tar.gz',
      },
    }

    await testStore.setBinaryEntry(spec, cacheKey, details)

    const entry = testStore.getManifestEntry(spec)
    expect(entry).toBeDefined()
    expect(entry?.type).toBe('binary')
    expect(entry?.cache_key).toBe(cacheKey)
    expect(entry?.details).toMatchObject(details)
  })

  it('should store both package and binary entries in same manifest', async () => {
    // Add package entry.
    const packageSpec = '@socketsecurity/cli@^2.0.11'
    const packageCacheKey = 'abc123def456'
    const packageDetails: PackageDetails = {
      installed_version: '2.0.11',
    }

    await testStore.setPackageEntry(
      packageSpec,
      packageCacheKey,
      packageDetails,
    )

    // Add binary entry.
    const binarySpec = 'https://example.com/binary.tar.gz:node-darwin-arm64'
    const binaryCacheKey = 'def456abc123'
    const binaryDetails: BinaryDetails = {
      checksum: 'sha256hash',
      checksum_algorithm: 'sha256',
      platform: 'darwin',
      arch: 'arm64',
      size: 2048000,
      source: {
        type: 'download',
        url: 'https://example.com/binary.tar.gz',
      },
    }

    await testStore.setBinaryEntry(binarySpec, binaryCacheKey, binaryDetails)

    // Verify both entries exist.
    const packageEntry = testStore.getManifestEntry(packageSpec)
    expect(packageEntry).toBeDefined()
    expect(packageEntry?.type).toBe('package')

    const binaryEntry = testStore.getManifestEntry(binarySpec)
    expect(binaryEntry).toBeDefined()
    expect(binaryEntry?.type).toBe('binary')

    // Verify manifest file contains both entries.
    const manifestContent = await fs.readFile(testManifestPath, 'utf8')
    const manifest = JSON.parse(manifestContent)

    expect(manifest[packageSpec]).toBeDefined()
    expect(manifest[packageSpec].type).toBe('package')

    expect(manifest[binarySpec]).toBeDefined()
    expect(manifest[binarySpec].type).toBe('binary')
  })

  it('should preserve legacy store record entries alongside new entries', async () => {
    // Add legacy entry.
    await testStore.set('@socketsecurity/cli', {
      timestampFetch: Date.now(),
      timestampNotification: 0,
      version: '2.0.10',
    })

    // Add new package entry.
    await testStore.setPackageEntry('@socketsecurity/cli@^2.0.11', 'cache123', {
      installed_version: '2.0.11',
    })

    // Add binary entry.
    await testStore.setBinaryEntry(
      'https://example.com/binary:node',
      'binary123',
      {
        checksum: 'abc',
        checksum_algorithm: 'sha256',
        platform: 'darwin',
        arch: 'arm64',
        size: 1000,
        source: {
          type: 'download',
          url: 'https://example.com/binary',
        },
      },
    )

    // Verify legacy entry still works.
    const legacyEntry = testStore.get('@socketsecurity/cli')
    expect(legacyEntry).toBeDefined()
    expect(legacyEntry?.version).toBe('2.0.10')

    // Verify new entries work.
    const packageEntry = testStore.getManifestEntry(
      '@socketsecurity/cli@^2.0.11',
    )
    expect(packageEntry?.type).toBe('package')

    const binaryEntry = testStore.getManifestEntry(
      'https://example.com/binary:node',
    )
    expect(binaryEntry?.type).toBe('binary')
  })

  it('should handle update_check details in package entries', async () => {
    const spec = '@socketsecurity/cli@^2.0.11'
    const cacheKey = 'abc123'
    const now = Date.now()
    const details: PackageDetails = {
      installed_version: '2.0.11',
      size: 1024000,
      update_check: {
        last_check: now,
        last_notification: now - 86400000,
        latest_known: '2.0.12',
      },
    }

    await testStore.setPackageEntry(spec, cacheKey, details)

    const entry = testStore.getManifestEntry(spec)
    expect(entry?.details).toMatchObject(details)

    // Verify the nested update_check object is preserved.
    const packageDetails = entry?.details as PackageDetails
    expect(packageDetails.update_check).toBeDefined()
    expect(packageDetails.update_check?.latest_known).toBe('2.0.12')
  })
})
