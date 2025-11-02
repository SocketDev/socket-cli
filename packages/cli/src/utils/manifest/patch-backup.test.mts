/* eslint-disable no-await-in-loop -- Sequential test operations required */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { clear } from '@socketsecurity/lib/cacache'

import {
  cleanupBackups,
  createBackup,
  getBackupInfo,
  getPatchMetadata,
  hasBackup,
  listAllPatches,
  listBackups,
  restoreAllBackups,
  restoreBackup,
} from './patch-backup.mts'

describe('patch-backup', () => {
  let testDir: string
  let originalHome: string | undefined

  beforeEach(async () => {
    // Create temporary test directory
    testDir = await mkdtemp(join(tmpdir(), 'patch-backup-test-'))

    // Override HOME to use test directory
    originalHome = process.env['HOME']
    process.env['HOME'] = testDir

    // Clear cacache before each test
    await clear()
  })

  afterEach(async () => {
    // Restore original HOME
    if (originalHome !== undefined) {
      process.env['HOME'] = originalHome
    } else {
      delete process.env['HOME']
    }

    // Clean up test directory
    await rm(testDir, { recursive: true, force: true })
  })

  describe('createBackup', () => {
    it('creates backup of a file', async () => {
      const testFile = join(testDir, 'test-file.js')
      const testContent = 'console.log("hello world");'
      await writeFile(testFile, testContent)

      const uuid = 'test-uuid-123'
      const backupInfo = await createBackup(uuid, testFile)

      expect(backupInfo.size).toBe(testContent.length)
      expect(backupInfo.integrity).toMatch(/^sha256-/)
      expect(backupInfo.originalPath).toBe(testFile)
      expect(backupInfo.backedUpAt).toBeDefined()
    })

    it('creates metadata file on first backup', async () => {
      const testFile = join(testDir, 'test-file.js')
      await writeFile(testFile, 'content')

      const uuid = 'test-uuid-123'
      await createBackup(uuid, testFile)

      const metadata = await getPatchMetadata(uuid)
      expect(metadata).toBeDefined()
      expect(metadata?.uuid).toBe(uuid)
      expect(metadata?.patchedAt).toBeDefined()
      expect(Object.keys(metadata?.files)).toHaveLength(1)
    })

    it('updates metadata for multiple files', async () => {
      const uuid = 'test-uuid-123'

      const file1 = join(testDir, 'file1.js')
      const file2 = join(testDir, 'file2.js')
      await writeFile(file1, 'content 1')
      await writeFile(file2, 'content 2')

      await createBackup(uuid, file1)
      await createBackup(uuid, file2)

      const metadata = await getPatchMetadata(uuid)
      expect(Object.keys(metadata?.files)).toHaveLength(2)
      expect(metadata?.files[file1]).toBeDefined()
      expect(metadata?.files[file2]).toBeDefined()
    })

    it('handles nested file paths', async () => {
      const nestedDir = join(testDir, 'deeply', 'nested', 'path')
      await mkdir(nestedDir, { recursive: true })
      const testFile = join(nestedDir, 'test.js')
      await writeFile(testFile, 'nested content')

      const uuid = 'test-uuid-123'
      const backupInfo = await createBackup(uuid, testFile)

      expect(backupInfo.originalPath).toBe(testFile)
    })
  })

  describe('restoreBackup', () => {
    it('restores a backed up file', async () => {
      const testFile = join(testDir, 'test-file.js')
      const originalContent = 'original content'
      await writeFile(testFile, originalContent)

      const uuid = 'test-uuid-123'
      await createBackup(uuid, testFile)

      // Modify file
      await writeFile(testFile, 'modified content')

      // Restore
      const restored = await restoreBackup(uuid, testFile)
      expect(restored).toBe(true)

      // Verify content restored
      const restoredContent = await readFile(testFile, 'utf-8')
      expect(restoredContent).toBe(originalContent)
    })

    it('returns false for non-existent backup', async () => {
      const testFile = join(testDir, 'test-file.js')
      const restored = await restoreBackup('non-existent-uuid', testFile)
      expect(restored).toBe(false)
    })

    it('returns false for non-existent file in patch', async () => {
      const testFile = join(testDir, 'test-file.js')
      await writeFile(testFile, 'content')

      const uuid = 'test-uuid-123'
      await createBackup(uuid, testFile)

      const restored = await restoreBackup(uuid, join(testDir, 'other-file.js'))
      expect(restored).toBe(false)
    })

    it('creates parent directories if needed', async () => {
      const nestedPath = join(testDir, 'new', 'nested', 'path')
      await mkdir(nestedPath, { recursive: true })
      const testFile = join(nestedPath, 'test.js')
      await writeFile(testFile, 'content')

      const uuid = 'test-uuid-123'
      await createBackup(uuid, testFile)

      // Remove parent directories
      await rm(join(testDir, 'new'), { recursive: true })

      // Restore should recreate directories
      const restored = await restoreBackup(uuid, testFile)
      expect(restored).toBe(true)

      const restoredContent = await readFile(testFile, 'utf-8')
      expect(restoredContent).toBe('content')
    })
  })

  describe('restoreAllBackups', () => {
    it('restores all backed up files', async () => {
      const uuid = 'test-uuid-123'

      const file1 = join(testDir, 'file1.js')
      const file2 = join(testDir, 'file2.js')
      await writeFile(file1, 'content 1')
      await writeFile(file2, 'content 2')

      await createBackup(uuid, file1)
      await createBackup(uuid, file2)

      // Modify files
      await writeFile(file1, 'modified 1')
      await writeFile(file2, 'modified 2')

      // Restore all
      const result = await restoreAllBackups(uuid)

      expect(result.restored).toHaveLength(2)
      expect(result.failed).toHaveLength(0)

      const restored1 = await readFile(file1, 'utf-8')
      const restored2 = await readFile(file2, 'utf-8')
      expect(restored1).toBe('content 1')
      expect(restored2).toBe('content 2')
    })

    it('returns empty arrays for non-existent patch', async () => {
      const result = await restoreAllBackups('non-existent-uuid')
      expect(result.restored).toHaveLength(0)
      expect(result.failed).toHaveLength(0)
    })

    it('reports failed restorations', async () => {
      const uuid = 'test-uuid-123'

      const file1 = join(testDir, 'file1.js')
      const file2 = join(testDir, 'file2.js')
      await writeFile(file1, 'content 1')
      await writeFile(file2, 'content 2')

      await createBackup(uuid, file1)
      await createBackup(uuid, file2)

      // Delete one file's cache entry to cause restore failure
      await clear()

      const result = await restoreAllBackups(uuid)

      // Both should fail since we cleared the cache
      expect(result.restored).toHaveLength(0)
      expect(result.failed).toHaveLength(2)
    })
  })

  describe('listBackups', () => {
    it('lists all backed up files for a patch', async () => {
      const uuid = 'test-uuid-123'

      const file1 = join(testDir, 'file1.js')
      const file2 = join(testDir, 'file2.js')
      await writeFile(file1, 'content 1')
      await writeFile(file2, 'content 2')

      await createBackup(uuid, file1)
      await createBackup(uuid, file2)

      const backups = await listBackups(uuid)

      expect(backups).toHaveLength(2)
      expect(backups).toContain(file1)
      expect(backups).toContain(file2)
    })

    it('returns undefined for non-existent patch', async () => {
      const backups = await listBackups('non-existent-uuid')
      expect(backups).toBeUndefined()
    })

    it('returns empty array for patch with no files', async () => {
      const uuid = 'test-uuid-123'

      // Create metadata manually with no files
      const metadataPath = join(
        testDir,
        '.socket',
        '_patches',
        'manifests',
        `${uuid}.json`,
      )
      await mkdir(join(testDir, '.socket', '_patches', 'manifests'), {
        recursive: true,
      })
      await writeFile(
        metadataPath,
        JSON.stringify({
          uuid,
          patchedAt: new Date().toISOString(),
          files: {},
        }),
      )

      const backups = await listBackups(uuid)
      expect(backups).toHaveLength(0)
    })
  })

  describe('getBackupInfo', () => {
    it('returns backup info for a file', async () => {
      const testFile = join(testDir, 'test-file.js')
      const testContent = 'test content'
      await writeFile(testFile, testContent)

      const uuid = 'test-uuid-123'
      await createBackup(uuid, testFile)

      const info = await getBackupInfo(uuid, testFile)

      expect(info).toBeDefined()
      expect(info?.size).toBe(testContent.length)
      expect(info?.integrity).toMatch(/^sha256-/)
      expect(info?.originalPath).toBe(testFile)
    })

    it('returns undefined for non-existent file', async () => {
      const info = await getBackupInfo(
        'non-existent-uuid',
        join(testDir, 'test.js'),
      )
      expect(info).toBeUndefined()
    })
  })

  describe('getPatchMetadata', () => {
    it('returns metadata for a patch', async () => {
      const testFile = join(testDir, 'test-file.js')
      await writeFile(testFile, 'content')

      const uuid = 'test-uuid-123'
      await createBackup(uuid, testFile)

      const metadata = await getPatchMetadata(uuid)

      expect(metadata).toBeDefined()
      expect(metadata?.uuid).toBe(uuid)
      expect(metadata?.patchedAt).toBeDefined()
      expect(metadata?.files).toBeDefined()
    })

    it('returns undefined for non-existent patch', async () => {
      const metadata = await getPatchMetadata('non-existent-uuid')
      expect(metadata).toBeUndefined()
    })
  })

  describe('hasBackup', () => {
    it('returns true for existing backup', async () => {
      const testFile = join(testDir, 'test-file.js')
      await writeFile(testFile, 'content')

      const uuid = 'test-uuid-123'
      await createBackup(uuid, testFile)

      const exists = await hasBackup(uuid, testFile)
      expect(exists).toBe(true)
    })

    it('returns false for non-existent backup', async () => {
      const exists = await hasBackup(
        'non-existent-uuid',
        join(testDir, 'test.js'),
      )
      expect(exists).toBe(false)
    })
  })

  describe('cleanupBackups', () => {
    it('removes all backups and metadata', async () => {
      const uuid = 'test-uuid-123'

      const file1 = join(testDir, 'file1.js')
      const file2 = join(testDir, 'file2.js')
      await writeFile(file1, 'content 1')
      await writeFile(file2, 'content 2')

      await createBackup(uuid, file1)
      await createBackup(uuid, file2)

      // Verify backups exist
      expect(await hasBackup(uuid, file1)).toBe(true)
      expect(await hasBackup(uuid, file2)).toBe(true)

      // Cleanup
      const cleaned = await cleanupBackups(uuid)
      expect(cleaned).toBe(true)

      // Verify backups removed
      expect(await getPatchMetadata(uuid)).toBeUndefined()
      expect(await listBackups(uuid)).toBeUndefined()
    })

    it('returns false for non-existent patch', async () => {
      const cleaned = await cleanupBackups('non-existent-uuid')
      expect(cleaned).toBe(false)
    })

    it('handles already-deleted backups gracefully', async () => {
      const uuid = 'test-uuid-123'

      const testFile = join(testDir, 'test-file.js')
      await writeFile(testFile, 'content')
      await createBackup(uuid, testFile)

      // Cleanup twice
      const cleaned1 = await cleanupBackups(uuid)
      const cleaned2 = await cleanupBackups(uuid)

      expect(cleaned1).toBe(true)
      expect(cleaned2).toBe(false) // Patch no longer exists
    })
  })

  describe('listAllPatches', () => {
    it('lists all patch UUIDs', async () => {
      const file = join(testDir, 'test.js')
      await writeFile(file, 'content')

      await createBackup('uuid-1', file)
      await createBackup('uuid-2', file)
      await createBackup('uuid-3', file)

      const patches = await listAllPatches()

      expect(patches).toHaveLength(3)
      expect(patches).toContain('uuid-1')
      expect(patches).toContain('uuid-2')
      expect(patches).toContain('uuid-3')
    })

    it('returns empty array when no patches exist', async () => {
      const patches = await listAllPatches()
      expect(patches).toHaveLength(0)
    })
  })

  describe('integrity verification', () => {
    it('verifies file integrity on restore', async () => {
      const testFile = join(testDir, 'test-file.js')
      const originalContent = 'original content'
      await writeFile(testFile, originalContent)

      const uuid = 'test-uuid-123'
      const backupInfo = await createBackup(uuid, testFile)

      // Restore with integrity check
      const restored = await restoreBackup(uuid, testFile)
      expect(restored).toBe(true)

      // Verify integrity matches
      const info = await getBackupInfo(uuid, testFile)
      expect(info?.integrity).toBe(backupInfo.integrity)
    })
  })

  describe('concurrent operations', () => {
    it('handles multiple backups for same patch concurrently', async () => {
      const uuid = 'test-uuid-123'

      const files = Array.from({ length: 5 }, (_, i) =>
        join(testDir, `file${i}.js`),
      )

      // Create files
      await Promise.allSettled(files.map((file, i) => writeFile(file, `content ${i}`)))

      // Create backups concurrently
      const settled = await Promise.allSettled(
        files.map(file => createBackup(uuid, file)),
      )
      const results = settled.filter(r => r.status === 'fulfilled').map(r => r.value)

      // Verify all backups were created
      expect(results).toHaveLength(5)
      results.forEach(info => {
        expect(info.integrity).toMatch(/^sha256-/)
      })

      // Small delay to ensure all writes complete
      await new Promise(resolve => setTimeout(resolve, 50))

      const backups = await listBackups(uuid)
      expect(backups).toHaveLength(5)

      const metadata = await getPatchMetadata(uuid)
      expect(Object.keys(metadata?.files)).toHaveLength(5)
    })

    it('handles sequential backups for same patch', async () => {
      const uuid = 'test-uuid-456'

      const files = Array.from({ length: 3 }, (_, i) =>
        join(testDir, `seq-file${i}.js`),
      )

      // Create files
      await Promise.allSettled(files.map((file, i) => writeFile(file, `content ${i}`)))

      // Create backups sequentially
      for (const file of files) {
        await createBackup(uuid, file)
      }

      const backups = await listBackups(uuid)
      expect(backups).toHaveLength(3)

      const metadata = await getPatchMetadata(uuid)
      expect(Object.keys(metadata?.files)).toHaveLength(3)
    })
  })
})
