import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  addPatch,
  getAllPatches,
  getPatch,
  hasPatch,
  listPatches,
  migrateHashes,
  type PatchManifest,
  type PatchRecord,
  readManifest,
  removePatch,
  validateManifest,
  writeManifest,
} from './index.mts'

describe('patch-manifest', () => {
  let testDir: string

  beforeEach(async () => {
    // Create temporary test directory
    testDir = await mkdtemp(join(tmpdir(), 'patch-manifest-test-'))
  })

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true })
  })

  // Helper to create a sample patch record
  // Use sequential valid UUIDs for testing
  const TEST_UUIDS = [
    '123e4567-e89b-12d3-a456-426614174000',
    '223e4567-e89b-12d3-a456-426614174001',
    '323e4567-e89b-12d3-a456-426614174002',
    '423e4567-e89b-12d3-a456-426614174003',
    '523e4567-e89b-12d3-a456-426614174004',
    '623e4567-e89b-12d3-a456-426614174005',
    '723e4567-e89b-12d3-a456-426614174006',
    '823e4567-e89b-12d3-a456-426614174007',
    '923e4567-e89b-12d3-a456-426614174008',
    'a23e4567-e89b-12d3-a456-426614174009',
  ]

  function createSamplePatch(index = 0): PatchRecord {
    return {
      uuid: TEST_UUIDS[index] || TEST_UUIDS[0],
      exportedAt: new Date().toISOString(),
      files: {
        'node_modules/lodash/index.js': {
          beforeHash: 'sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc=',
          afterHash: 'sha256-9f8e7d6c5b4a3210fedcba9876543210abcdef12345=',
        },
      },
      vulnerabilities: {
        'GHSA-jrhj-2j3q-xf3v': {
          cves: ['CVE-2021-23337'],
          summary: 'Command injection in lodash',
          severity: 'HIGH',
          description: 'Lodash versions prior to 4.17.21 are vulnerable...',
        },
      },
      description: 'Fixes command injection vulnerability',
      license: 'MIT',
      tier: 'free',
    }
  }

  describe('readManifest', () => {
    it('returns empty manifest when file does not exist', async () => {
      const manifest = await readManifest(testDir)

      expect(manifest.version).toBe('1.0.0')
      expect(manifest.patches).toEqual({})
    })

    it('reads existing manifest file', async () => {
      const manifestPath = join(testDir, '.socket', 'manifest.json')
      await mkdir(join(testDir, '.socket'), { recursive: true })

      const testManifest = {
        version: '1.0.0',
        patches: {
          'npm:lodash@4.17.20': createSamplePatch(0),
        },
      }

      await writeFile(manifestPath, JSON.stringify(testManifest, null, 2))

      const manifest = await readManifest(testDir)

      expect(manifest.version).toBe('1.0.0')
      expect(Object.keys(manifest.patches)).toHaveLength(1)
      expect(manifest.patches['npm:lodash@4.17.20']).toBeDefined()
    })

    it('defaults version field if missing', async () => {
      const manifestPath = join(testDir, '.socket', 'manifest.json')
      await mkdir(join(testDir, '.socket'), { recursive: true })

      // Write manifest without version field
      await writeFile(manifestPath, JSON.stringify({ patches: {} }, null, 2))

      const manifest = await readManifest(testDir)

      expect(manifest.version).toBe('1.0.0')
    })

    it('throws on invalid manifest structure', async () => {
      const manifestPath = join(testDir, '.socket', 'manifest.json')
      await mkdir(join(testDir, '.socket'), { recursive: true })

      await writeFile(
        manifestPath,
        JSON.stringify({ invalid: 'data' }, null, 2),
      )

      await expect(readManifest(testDir)).rejects.toThrow()
    })

    it('throws on invalid patch record', async () => {
      const manifestPath = join(testDir, '.socket', 'manifest.json')
      await mkdir(join(testDir, '.socket'), { recursive: true })

      const invalidManifest = {
        version: '1.0.0',
        patches: {
          'npm:lodash@4.17.20': {
            uuid: 'not-a-uuid', // Invalid UUID
            exportedAt: '2025-01-14T12:00:00Z',
            files: {},
            vulnerabilities: {},
            description: 'Test',
            license: 'MIT',
            tier: 'free',
          },
        },
      }

      await writeFile(manifestPath, JSON.stringify(invalidManifest, null, 2))

      await expect(readManifest(testDir)).rejects.toThrow()
    })
  })

  describe('writeManifest', () => {
    it('creates manifest file', async () => {
      const manifest: PatchManifest = {
        version: '1.0.0',
        patches: {},
      }

      await writeManifest(manifest, testDir)

      const manifestPath = join(testDir, '.socket', 'manifest.json')
      const content = await readFile(manifestPath, 'utf-8')
      const parsed = JSON.parse(content)

      expect(parsed.version).toBe('1.0.0')
      expect(parsed.patches).toEqual({})
    })

    it('creates parent directory if needed', async () => {
      const manifest: PatchManifest = {
        version: '1.0.0',
        patches: {
          'npm:lodash@4.17.20': createSamplePatch(0),
        },
      }

      await writeManifest(manifest, testDir)

      const manifestPath = join(testDir, '.socket', 'manifest.json')
      const content = await readFile(manifestPath, 'utf-8')

      expect(content).toBeTruthy()
    })

    it('validates manifest before writing', async () => {
      const invalidManifest = {
        version: '1.0.0',
        patches: {
          'npm:lodash@4.17.20': {
            uuid: 'not-a-uuid',
          },
        },
      } as any

      await expect(writeManifest(invalidManifest, testDir)).rejects.toThrow()
    })

    it('formats JSON with 2 spaces', async () => {
      const manifest: PatchManifest = {
        version: '1.0.0',
        patches: {
          'npm:lodash@4.17.20': createSamplePatch(0),
        },
      }

      await writeManifest(manifest, testDir)

      const manifestPath = join(testDir, '.socket', 'manifest.json')
      const content = await readFile(manifestPath, 'utf-8')

      // Check that it's properly formatted
      expect(content).toContain('  "version"')
      expect(content).toContain('  "patches"')
    })

    it('overwrites existing manifest', async () => {
      const manifest1: PatchManifest = {
        version: '1.0.0',
        patches: {
          'npm:lodash@4.17.20': createSamplePatch(0),
        },
      }

      await writeManifest(manifest1, testDir)

      const manifest2: PatchManifest = {
        version: '1.0.0',
        patches: {
          'npm:express@4.17.1': createSamplePatch(1),
        },
      }

      await writeManifest(manifest2, testDir)

      const final = await readManifest(testDir)

      expect(Object.keys(final.patches)).toHaveLength(1)
      expect(final.patches['npm:express@4.17.1']).toBeDefined()
      expect(final.patches['npm:lodash@4.17.20']).toBeUndefined()
    })
  })

  describe('addPatch', () => {
    it('adds patch to empty manifest', async () => {
      const patch = createSamplePatch(0)

      await addPatch('npm:lodash@4.17.20', patch, testDir)

      const manifest = await readManifest(testDir)

      expect(Object.keys(manifest.patches)).toHaveLength(1)
      expect(manifest.patches['npm:lodash@4.17.20']).toEqual(patch)
    })

    it('adds multiple patches', async () => {
      const patch1 = createSamplePatch(0)
      const patch2 = createSamplePatch(1)

      await addPatch('npm:lodash@4.17.20', patch1, testDir)
      await addPatch('npm:express@4.17.1', patch2, testDir)

      const manifest = await readManifest(testDir)

      expect(Object.keys(manifest.patches)).toHaveLength(2)
      expect(manifest.patches['npm:lodash@4.17.20']).toEqual(patch1)
      expect(manifest.patches['npm:express@4.17.1']).toEqual(patch2)
    })

    it('replaces existing patch', async () => {
      const patch1 = createSamplePatch(0)
      const patch2 = createSamplePatch(1)

      await addPatch('npm:lodash@4.17.20', patch1, testDir)
      await addPatch('npm:lodash@4.17.20', patch2, testDir)

      const manifest = await readManifest(testDir)

      expect(Object.keys(manifest.patches)).toHaveLength(1)
      expect(manifest.patches['npm:lodash@4.17.20'].uuid).toBe(TEST_UUIDS[1])
    })

    it('creates manifest file on first add', async () => {
      const patch = createSamplePatch(0)

      await addPatch('npm:lodash@4.17.20', patch, testDir)

      const manifestPath = join(testDir, '.socket', 'manifest.json')
      const content = await readFile(manifestPath, 'utf-8')

      expect(content).toBeTruthy()
    })
  })

  describe('removePatch', () => {
    it('removes existing patch', async () => {
      const patch = createSamplePatch(0)

      await addPatch('npm:lodash@4.17.20', patch, testDir)

      const removed = await removePatch('npm:lodash@4.17.20', testDir)

      expect(removed).toBe(true)

      const manifest = await readManifest(testDir)
      expect(Object.keys(manifest.patches)).toHaveLength(0)
    })

    it('returns false for non-existent patch', async () => {
      const removed = await removePatch('npm:lodash@4.17.20', testDir)

      expect(removed).toBe(false)
    })

    it('removes specific patch and keeps others', async () => {
      const patch1 = createSamplePatch(0)
      const patch2 = createSamplePatch(1)

      await addPatch('npm:lodash@4.17.20', patch1, testDir)
      await addPatch('npm:express@4.17.1', patch2, testDir)

      const removed = await removePatch('npm:lodash@4.17.20', testDir)

      expect(removed).toBe(true)

      const manifest = await readManifest(testDir)
      expect(Object.keys(manifest.patches)).toHaveLength(1)
      expect(manifest.patches['npm:express@4.17.1']).toBeDefined()
    })
  })

  describe('getPatch', () => {
    it('returns patch for existing PURL', async () => {
      const patch = createSamplePatch(0)

      await addPatch('npm:lodash@4.17.20', patch, testDir)

      const retrieved = await getPatch('npm:lodash@4.17.20', testDir)

      expect(retrieved).toEqual(patch)
    })

    it('returns undefined for non-existent PURL', async () => {
      const retrieved = await getPatch('npm:lodash@4.17.20', testDir)

      expect(retrieved).toBeUndefined()
    })

    it('returns correct patch when multiple exist', async () => {
      const patch1 = createSamplePatch(0)
      const patch2 = createSamplePatch(1)

      await addPatch('npm:lodash@4.17.20', patch1, testDir)
      await addPatch('npm:express@4.17.1', patch2, testDir)

      const retrieved = await getPatch('npm:express@4.17.1', testDir)

      expect(retrieved?.uuid).toBe(TEST_UUIDS[1])
    })
  })

  describe('listPatches', () => {
    it('returns empty array for empty manifest', async () => {
      const purls = await listPatches(testDir)

      expect(purls).toEqual([])
    })

    it('returns all PURLs', async () => {
      const patch1 = createSamplePatch(0)
      const patch2 = createSamplePatch(1)

      await addPatch('npm:lodash@4.17.20', patch1, testDir)
      await addPatch('npm:express@4.17.1', patch2, testDir)

      const purls = await listPatches(testDir)

      expect(purls).toHaveLength(2)
      expect(purls).toContain('npm:lodash@4.17.20')
      expect(purls).toContain('npm:express@4.17.1')
    })

    it('returns updated list after removal', async () => {
      const patch1 = createSamplePatch(0)
      const patch2 = createSamplePatch(1)

      await addPatch('npm:lodash@4.17.20', patch1, testDir)
      await addPatch('npm:express@4.17.1', patch2, testDir)
      await removePatch('npm:lodash@4.17.20', testDir)

      const purls = await listPatches(testDir)

      expect(purls).toHaveLength(1)
      expect(purls).toContain('npm:express@4.17.1')
    })
  })

  describe('hasPatch', () => {
    it('returns true for existing patch', async () => {
      const patch = createSamplePatch(0)

      await addPatch('npm:lodash@4.17.20', patch, testDir)

      const exists = await hasPatch('npm:lodash@4.17.20', testDir)

      expect(exists).toBe(true)
    })

    it('returns false for non-existent patch', async () => {
      const exists = await hasPatch('npm:lodash@4.17.20', testDir)

      expect(exists).toBe(false)
    })

    it('returns false after removal', async () => {
      const patch = createSamplePatch(0)

      await addPatch('npm:lodash@4.17.20', patch, testDir)
      await removePatch('npm:lodash@4.17.20', testDir)

      const exists = await hasPatch('npm:lodash@4.17.20', testDir)

      expect(exists).toBe(false)
    })
  })

  describe('getAllPatches', () => {
    it('returns empty object for empty manifest', async () => {
      const patches = await getAllPatches(testDir)

      expect(patches).toEqual({})
    })

    it('returns all patches', async () => {
      const patch1 = createSamplePatch(0)
      const patch2 = createSamplePatch(1)

      await addPatch('npm:lodash@4.17.20', patch1, testDir)
      await addPatch('npm:express@4.17.1', patch2, testDir)

      const patches = await getAllPatches(testDir)

      expect(Object.keys(patches)).toHaveLength(2)
      expect(patches['npm:lodash@4.17.20']).toEqual(patch1)
      expect(patches['npm:express@4.17.1']).toEqual(patch2)
    })
  })

  describe('migrateHashes', () => {
    it('returns 0 for manifest with no legacy hashes', async () => {
      const patch = createSamplePatch(0)

      await addPatch('npm:lodash@4.17.20', patch, testDir)

      const migrated = await migrateHashes(testDir)

      expect(migrated).toBe(0)
    })

    it('detects legacy hashes', async () => {
      // Create manifest with legacy hash format
      const manifestPath = join(testDir, '.socket', 'manifest.json')
      await mkdir(join(testDir, '.socket'), { recursive: true })

      const legacyManifest = {
        version: '1.0.0',
        patches: {
          'npm:lodash@4.17.20': {
            uuid: '123e4567-e89b-12d3-a456-426614174000',
            exportedAt: '2025-01-14T12:00:00Z',
            files: {
              'node_modules/lodash/index.js': {
                beforeHash:
                  'git-sha256-0bd69098bd9b9cc5934a610ab65da429b525361147faa7b5b922919e9a23143d',
                afterHash:
                  'git-sha256-1cd69098bd9b9cc5934a610ab65da429b525361147faa7b5b922919e9a23143e',
              },
            },
            vulnerabilities: {},
            description: 'Test',
            license: 'MIT',
            tier: 'free',
          },
        },
      }

      await writeFile(manifestPath, JSON.stringify(legacyManifest, null, 2))

      const migrated = await migrateHashes(testDir)

      expect(migrated).toBe(2) // 2 legacy hashes detected
    })

    it('returns 0 for empty manifest', async () => {
      const migrated = await migrateHashes(testDir)

      expect(migrated).toBe(0)
    })
  })

  describe('validateManifest', () => {
    it('returns true for valid manifest', async () => {
      const patch = createSamplePatch(0)

      await addPatch('npm:lodash@4.17.20', patch, testDir)

      const valid = await validateManifest(testDir)

      expect(valid).toBe(true)
    })

    it('returns true for non-existent manifest', async () => {
      const valid = await validateManifest(testDir)

      expect(valid).toBe(true)
    })

    it('returns false for invalid manifest', async () => {
      const manifestPath = join(testDir, '.socket', 'manifest.json')
      await mkdir(join(testDir, '.socket'), { recursive: true })

      await writeFile(manifestPath, 'invalid json content')

      const valid = await validateManifest(testDir)

      expect(valid).toBe(false)
    })

    it('returns false for manifest with invalid structure', async () => {
      const manifestPath = join(testDir, '.socket', 'manifest.json')
      await mkdir(join(testDir, '.socket'), { recursive: true })

      await writeFile(
        manifestPath,
        JSON.stringify({ patches: { invalid: 'structure' } }, null, 2),
      )

      const valid = await validateManifest(testDir)

      expect(valid).toBe(false)
    })
  })

  describe('concurrent operations', () => {
    it('handles multiple concurrent adds', async () => {
      const patches = Array.from({ length: 5 }, (_, i) => createSamplePatch(i))

      // Add all patches concurrently
      await Promise.all(
        patches.map((patch, i) =>
          addPatch(`npm:package${i}@1.0.0`, patch, testDir),
        ),
      )

      const manifest = await readManifest(testDir)

      expect(Object.keys(manifest.patches)).toHaveLength(5)
    })

    it('handles mixed add/remove operations', async () => {
      const patch1 = createSamplePatch(0)
      const patch2 = createSamplePatch(1)
      const patch3 = createSamplePatch(2)

      await addPatch('npm:lodash@4.17.20', patch1, testDir)

      // Run operations in parallel
      await Promise.all([
        addPatch('npm:express@4.17.1', patch2, testDir),
        addPatch('npm:minimatch@3.0.4', patch3, testDir),
        removePatch('npm:lodash@4.17.20', testDir),
      ])

      const manifest = await readManifest(testDir)

      expect(Object.keys(manifest.patches)).toHaveLength(2)
      expect(manifest.patches['npm:lodash@4.17.20']).toBeUndefined()
      expect(manifest.patches['npm:express@4.17.1']).toBeDefined()
      expect(manifest.patches['npm:minimatch@3.0.4']).toBeDefined()
    })
  })
})
