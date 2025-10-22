/* eslint-disable no-await-in-loop -- Sequential file operations required */
/**
 * Patch Backup Utilities
 *
 * Manages backup/restore of files before applying patches.
 * Uses cacache for content storage and filesystem for metadata.
 *
 * Architecture:
 * - Backups stored in cacache: ~/.socket/_cacache
 * - Metadata stored in filesystem: ~/.socket/_patches/manifests/<uuid>.json
 * - Keys follow pattern: socket:patch:backup:<uuid>:<filepath-hash>
 *
 * Key Functions:
 * - createBackup: Store original file before patching
 * - restoreBackup: Restore single backed up file
 * - restoreAllBackups: Restore all files for a patch
 * - listBackups: List all backed up files for a patch
 * - cleanupBackups: Remove all backups for a patch
 */

import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import ssri from 'ssri'

import { get, put, remove } from '@socketsecurity/lib/cacache'
// @ts-expect-error - No type declarations available.

export interface BackupFileInfo {
  integrity: string // ssri format: sha256-base64
  size: number
  backedUpAt: string // ISO timestamp
  originalPath: string
}

export interface PatchBackupMetadata {
  uuid: string
  patchedAt: string // ISO timestamp
  files: Record<string, BackupFileInfo> // key = original file path
}

/**
 * Hash a file path to create a unique, filesystem-safe identifier.
 * Uses first 16 chars of SHA-256 hash for brevity while maintaining uniqueness.
 */
function hashFilePath(filePath: string): string {
  return crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 16)
}

/**
 * Build cacache key for a backup.
 */
function buildBackupKey(uuid: string, filePath: string): string {
  return `socket:patch:backup:${uuid}:${hashFilePath(filePath)}`
}

/**
 * Get the path to the metadata file for a patch.
 */
function getMetadataPath(uuid: string): string {
  const socketHome = process.env['HOME'] || process.env['USERPROFILE'] || '~'
  return join(socketHome, '.socket', '_patches', 'manifests', `${uuid}.json`)
}

/**
 * Read metadata for a patch.
 * Returns undefined if metadata file doesn't exist.
 */
async function readMetadata(
  uuid: string,
): Promise<PatchBackupMetadata | undefined> {
  try {
    const metadataPath = getMetadataPath(uuid)
    const data = await fs.readFile(metadataPath, 'utf-8')
    return JSON.parse(data) as PatchBackupMetadata
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

// Metadata operation queue to ensure sequential writes per UUID
const metadataOperations = new Map<string, Promise<any>>()

/**
 * Queue an operation for a specific UUID to ensure sequential execution.
 */
async function queueOperation<T>(
  uuid: string,
  operation: () => Promise<T>,
): Promise<T> {
  // Get the last pending operation for this UUID
  const previousOperation = metadataOperations.get(uuid) || Promise.resolve()

  // Chain this operation after the previous one
  const currentOperation = previousOperation.then(
    () => operation(),
    () => operation(), // Run even if previous failed
  )

  // Store this operation as the new "last" one
  metadataOperations.set(uuid, currentOperation)

  try {
    return await currentOperation
  } finally {
    // Clean up if this was the last operation
    if (metadataOperations.get(uuid) === currentOperation) {
      metadataOperations.delete(uuid)
    }
  }
}

/**
 * Update metadata with a transformation function, ensuring atomicity.
 * Re-reads metadata before applying changes to handle concurrent updates.
 */
async function updateMetadata(
  uuid: string,
  update: (metadata: PatchBackupMetadata | undefined) => PatchBackupMetadata,
): Promise<void> {
  return queueOperation(uuid, async () => {
    // Re-read metadata to get latest state
    const currentMetadata = await readMetadata(uuid)

    // Apply transformation
    const updatedMetadata = update(currentMetadata)

    // Write back
    const metadataPath = getMetadataPath(uuid)
    await fs.mkdir(dirname(metadataPath), { recursive: true })
    await fs.writeFile(
      metadataPath,
      JSON.stringify(updatedMetadata, null, 2),
      'utf-8',
    )
  })
}

/**
 * Create a backup of a file before applying a patch.
 *
 * Stores:
 * - File content in cacache (with integrity verification)
 * - Metadata in filesystem JSON (for quick lookups)
 *
 * @param uuid - Patch UUID
 * @param filePath - Absolute or relative path to file
 * @returns Backup info including integrity hash and size
 *
 * @example
 * const backup = await createBackup('abc-123', 'node_modules/lodash/index.js')
 * console.log('Backed up with hash:', backup.integrity)
 */
export async function createBackup(
  uuid: string,
  filePath: string,
): Promise<BackupFileInfo> {
  // Read original file
  const content = await fs.readFile(filePath)

  // Compute integrity using ssri
  const integrity = ssri.fromData(content, { algorithms: ['sha256'] })
  const integrityString = integrity.toString()

  // Store in cacache
  const cacheKey = buildBackupKey(uuid, filePath)
  await put(cacheKey, content, {
    integrity: integrityString,
    metadata: {
      originalPath: filePath,
      uuid,
      backedUpAt: new Date().toISOString(),
    },
  })

  // Create backup info
  const backupInfo: BackupFileInfo = {
    integrity: integrityString,
    size: content.length,
    backedUpAt: new Date().toISOString(),
    originalPath: filePath,
  }

  // Update metadata with locking
  await updateMetadata(uuid, metadata => {
    if (!metadata) {
      metadata = {
        uuid,
        patchedAt: new Date().toISOString(),
        files: {},
      }
    }
    metadata.files[filePath] = backupInfo
    return metadata
  })

  return backupInfo
}

/**
 * Restore a single backed up file.
 *
 * Retrieves content from cacache and writes back to original location.
 * Verifies integrity on retrieval.
 *
 * @param uuid - Patch UUID
 * @param filePath - Original file path to restore
 * @returns True if restored successfully, false if backup not found
 *
 * @example
 * const restored = await restoreBackup('abc-123', 'node_modules/lodash/index.js')
 * if (restored) {
 *   console.log('File restored successfully')
 * }
 */
export async function restoreBackup(
  uuid: string,
  filePath: string,
): Promise<boolean> {
  // Read metadata to get integrity hash
  const metadata = await readMetadata(uuid)
  if (!metadata) {
    return false
  }

  const backupInfo = metadata.files[filePath]
  if (!backupInfo) {
    return false
  }

  // Retrieve from cacache with integrity check
  const cacheKey = buildBackupKey(uuid, filePath)
  try {
    const entry = await get(cacheKey, {
      integrity: backupInfo.integrity, // Verify on retrieval
    })

    // Ensure parent directory exists
    await fs.mkdir(dirname(filePath), { recursive: true })

    // Write back to original location
    await fs.writeFile(filePath, entry.data)

    return true
  } catch (error: any) {
    // Entry not found or integrity mismatch
    if (error.code === 'ENOENT' || error.code === 'EINTEGRITY') {
      return false
    }
    throw error
  }
}

/**
 * Restore all backed up files for a patch.
 *
 * @param uuid - Patch UUID
 * @returns Object with success status and list of restored/failed files
 *
 * @example
 * const result = await restoreAllBackups('abc-123')
 * console.log('Restored:', result.restored.length)
 * console.log('Failed:', result.failed.length)
 */
export async function restoreAllBackups(uuid: string): Promise<{
  restored: string[]
  failed: string[]
}> {
  const metadata = await readMetadata(uuid)
  if (!metadata) {
    return { restored: [], failed: [] }
  }

  const restored: string[] = []
  const failed: string[] = []

  for (const filePath of Object.keys(metadata.files)) {
    const success = await restoreBackup(uuid, filePath)
    if (success) {
      restored.push(filePath)
    } else {
      failed.push(filePath)
    }
  }

  return { restored, failed }
}

/**
 * List all backed up files for a patch.
 *
 * @param uuid - Patch UUID
 * @returns Array of file paths that have backups, or undefined if patch not found
 *
 * @example
 * const files = await listBackups('abc-123')
 * if (files) {
 *   console.log('Backed up files:', files)
 * }
 */
export async function listBackups(uuid: string): Promise<string[] | undefined> {
  const metadata = await readMetadata(uuid)
  if (!metadata) {
    return undefined
  }

  return Object.keys(metadata.files)
}

/**
 * Get detailed backup information for a specific file.
 *
 * @param uuid - Patch UUID
 * @param filePath - File path to query
 * @returns Backup info or undefined if not found
 *
 * @example
 * const info = await getBackupInfo('abc-123', 'node_modules/lodash/index.js')
 * if (info) {
 *   console.log('Backed up at:', info.backedUpAt)
 *   console.log('Size:', info.size, 'bytes')
 *   console.log('Integrity:', info.integrity)
 * }
 */
export async function getBackupInfo(
  uuid: string,
  filePath: string,
): Promise<BackupFileInfo | undefined> {
  const metadata = await readMetadata(uuid)
  return metadata?.files[filePath]
}

/**
 * Get metadata for a patch.
 *
 * @param uuid - Patch UUID
 * @returns Metadata object or undefined if not found
 *
 * @example
 * const metadata = await getPatchMetadata('abc-123')
 * if (metadata) {
 *   console.log('Patch applied at:', metadata.patchedAt)
 *   console.log('Files backed up:', Object.keys(metadata.files).length)
 * }
 */
export async function getPatchMetadata(
  uuid: string,
): Promise<PatchBackupMetadata | undefined> {
  return await readMetadata(uuid)
}

/**
 * Clean up all backups for a patch.
 *
 * Removes:
 * - All backup entries from cacache
 * - Metadata file from filesystem
 *
 * @param uuid - Patch UUID
 * @returns True if cleanup successful, false if patch not found
 *
 * @example
 * const cleaned = await cleanupBackups('abc-123')
 * if (cleaned) {
 *   console.log('All backups removed')
 * }
 */
export async function cleanupBackups(uuid: string): Promise<boolean> {
  const metadata = await readMetadata(uuid)
  if (!metadata) {
    return false
  }

  // Remove each backup from cacache
  const errors: string[] = []
  for (const filePath of Object.keys(metadata.files)) {
    try {
      const cacheKey = buildBackupKey(uuid, filePath)
      await remove(cacheKey)
    } catch (error: any) {
      // Ignore ENOENT - already deleted
      if (error.code !== 'ENOENT') {
        errors.push(filePath)
      }
    }
  }

  // Remove metadata file
  try {
    const metadataPath = getMetadataPath(uuid)
    await fs.unlink(metadataPath)
  } catch (error: any) {
    // Ignore ENOENT - already deleted
    if (error.code !== 'ENOENT') {
      throw error
    }
  }

  // Return false if any errors occurred
  return errors.length === 0
}

/**
 * Check if a backup exists for a file.
 *
 * @param uuid - Patch UUID
 * @param filePath - File path to check
 * @returns True if backup exists
 *
 * @example
 * if (await hasBackup('abc-123', 'node_modules/lodash/index.js')) {
 *   console.log('Backup exists')
 * }
 */
export async function hasBackup(
  uuid: string,
  filePath: string,
): Promise<boolean> {
  const info = await getBackupInfo(uuid, filePath)
  return info !== undefined
}

/**
 * Check if any backup exists for a patch UUID.
 *
 * @param uuid - Patch UUID
 * @returns True if any backup exists for this patch
 *
 * @example
 * if (await hasBackupForPatch('uuid-123')) {
 *   console.log('Backup available')
 * }
 */
export async function hasBackupForPatch(uuid: string): Promise<boolean> {
  const metadata = await getPatchMetadata(uuid)
  return metadata !== undefined
}

/**
 * List all patch UUIDs that have backups.
 *
 * @returns Array of UUIDs
 *
 * @example
 * const patches = await listAllPatches()
 * console.log('Found', patches.length, 'patches with backups')
 */
export async function listAllPatches(): Promise<string[]> {
  const socketHome = process.env['HOME'] || process.env['USERPROFILE'] || '~'
  const manifestsDir = join(socketHome, '.socket', '_patches', 'manifests')

  try {
    const files = await fs.readdir(manifestsDir)
    // Extract UUIDs from .json filenames
    return files.filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)) // Remove .json extension
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}
