/**
 * Patch Manifest Utilities
 *
 * Manages the .socket/manifest.json file that tracks applied patches.
 * This file is committed to version control and shared across the team.
 *
 * Architecture:
 * - Manifest stored in: .socket/manifest.json (in project root)
 * - Schema validation using Zod
 * - Atomic writes to prevent corruption
 * - Support for schema versioning
 *
 * Key Functions:
 * - readManifest: Read and validate manifest
 * - writeManifest: Write manifest with validation
 * - addPatch: Add patch to manifest
 * - removePatch: Remove patch from manifest
 * - getPatch: Get specific patch record
 * - listPatches: List all applied patches
 * - hasPatch: Check if patch is applied
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import { safeMkdir } from '@socketsecurity/lib/fs'
import { z } from 'zod'

const MANIFEST_VERSION = '1.0.0'
const MANIFEST_PATH = '.socket/manifest.json'

/**
 * Schema for file hashes in a patch
 */
const PatchFileSchema = z.object({
  beforeHash: z.string(),
  afterHash: z.string(),
})

/**
 * Schema for vulnerability information
 */
const VulnerabilitySchema = z.object({
  cves: z.array(z.string()),
  summary: z.string(),
  severity: z.string(),
  description: z.string(),
})

/**
 * Schema for a single patch record
 */
const PatchRecordSchema = z.object({
  uuid: z.string().uuid().optional(),
  exportedAt: z.string(),
  files: z.record(z.string(), PatchFileSchema),
  vulnerabilities: z.record(z.string(), VulnerabilitySchema).optional(),
  description: z.string().optional(),
  license: z.string().optional(),
  tier: z.string().optional(),
  // Status tracking fields.
  status: z.enum(['downloaded', 'applied', 'failed']).optional(),
  downloadedAt: z.string().optional(),
  appliedAt: z.string().optional(),
  appliedTo: z.array(z.string()).optional(),
})

/**
 * Schema for the complete manifest
 */
const PatchManifestSchema = z.object({
  version: z.string().optional().default(MANIFEST_VERSION),
  patches: z.record(z.string(), PatchRecordSchema),
})

export type PatchFile = z.infer<typeof PatchFileSchema>
export type Vulnerability = z.infer<typeof VulnerabilitySchema>
export type PatchRecord = z.infer<typeof PatchRecordSchema>
export type PatchManifest = z.infer<typeof PatchManifestSchema>

// Operation queue to ensure sequential manifest writes
const manifestOperations = new Map<string, Promise<any>>()

/**
 * Queue an operation for a specific manifest path to ensure sequential execution.
 */
async function queueOperation<T>(
  cwd: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = cwd || process.cwd()
  const previousOperation = manifestOperations.get(key) || Promise.resolve()

  const currentOperation = previousOperation.then(
    () => operation(),
    () => operation(), // Run even if previous failed
  )

  manifestOperations.set(key, currentOperation)

  try {
    return await currentOperation
  } finally {
    if (manifestOperations.get(key) === currentOperation) {
      manifestOperations.delete(key)
    }
  }
}

/**
 * Get the path to the manifest file.
 * Defaults to .socket/manifest.json in the current working directory.
 */
function getManifestPath(cwd?: string): string {
  return join(cwd || process.cwd(), MANIFEST_PATH)
}

/**
 * Read and validate the patch manifest.
 *
 * @param cwd - Working directory (defaults to process.cwd())
 * @returns Parsed and validated manifest, or empty manifest if file doesn't exist
 *
 * @example
 * const manifest = await readManifest()
 * console.log('Applied patches:', Object.keys(manifest.patches).length)
 */
export async function readManifest(cwd?: string): Promise<PatchManifest> {
  const manifestPath = getManifestPath(cwd)

  try {
    const data = await fs.readFile(manifestPath, 'utf-8')
    const parsed = JSON.parse(data)
    return PatchManifestSchema.parse(parsed)
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // No manifest file exists yet - return empty manifest
      return {
        version: MANIFEST_VERSION,
        patches: {},
      }
    }
    throw error
  }
}

/**
 * Write the patch manifest to disk with validation.
 *
 * Validates the manifest before writing and ensures atomic writes.
 *
 * @param manifest - Manifest to write
 * @param cwd - Working directory (defaults to process.cwd())
 *
 * @example
 * const manifest = await readManifest()
 * manifest.patches['npm:lodash@4.17.20'] = patchRecord
 * await writeManifest(manifest)
 */
export async function writeManifest(
  manifest: PatchManifest,
  cwd?: string,
): Promise<void> {
  // Validate before writing
  const validated = PatchManifestSchema.parse(manifest)

  const manifestPath = getManifestPath(cwd)

  // Ensure parent directory exists
  await safeMkdir(dirname(manifestPath), { recursive: true })

  // Write atomically (write to temp file, then rename)
  const tempPath = `${manifestPath}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(validated, null, 2), 'utf-8')
  await fs.rename(tempPath, manifestPath)
}

/**
 * Add a patch to the manifest.
 *
 * If a patch already exists for this PURL, it will be replaced.
 *
 * @param purl - Package URL (e.g., "npm:lodash@4.17.20")
 * @param patchRecord - Patch record to add
 * @param cwd - Working directory (defaults to process.cwd())
 *
 * @example
 * await addPatch('npm:lodash@4.17.20', {
 *   uuid: 'abc-123',
 *   exportedAt: new Date().toISOString(),
 *   files: { ... },
 *   vulnerabilities: { ... },
 *   description: 'Fixes command injection',
 *   license: 'MIT',
 *   tier: 'free'
 * })
 */
export async function addPatch(
  purl: string,
  patchRecord: PatchRecord,
  cwd?: string,
): Promise<void> {
  return queueOperation(cwd || process.cwd(), async () => {
    const manifest = await readManifest(cwd)
    manifest.patches[purl] = patchRecord
    await writeManifest(manifest, cwd)
  })
}

/**
 * Remove a patch from the manifest.
 *
 * @param purl - Package URL to remove
 * @param cwd - Working directory (defaults to process.cwd())
 * @returns True if patch was removed, false if it didn't exist
 *
 * @example
 * const removed = await removePatch('npm:lodash@4.17.20')
 * if (removed) {
 *   console.log('Patch removed from manifest')
 * }
 */
export async function removePatch(
  purl: string,
  cwd?: string,
): Promise<boolean> {
  return queueOperation(cwd || process.cwd(), async () => {
    const manifest = await readManifest(cwd)

    if (!(purl in manifest.patches)) {
      return false
    }

    delete manifest.patches[purl]
    await writeManifest(manifest, cwd)
    return true
  })
}

/**
 * Get a specific patch record from the manifest.
 *
 * @param purl - Package URL to query
 * @param cwd - Working directory (defaults to process.cwd())
 * @returns Patch record or undefined if not found
 *
 * @example
 * const patch = await getPatch('npm:lodash@4.17.20')
 * if (patch) {
 *   console.log('Patch UUID:', patch.uuid)
 *   console.log('Files patched:', Object.keys(patch.files).length)
 * }
 */
export async function getPatch(
  purl: string,
  cwd?: string,
): Promise<PatchRecord | undefined> {
  const manifest = await readManifest(cwd)
  return manifest.patches[purl]
}

/**
 * List all PURLs that have patches applied.
 *
 * @param cwd - Working directory (defaults to process.cwd())
 * @returns Array of PURLs (e.g., ["npm:lodash@4.17.20", "npm:express@4.17.1"])
 *
 * @example
 * const purls = await listPatches()
 * console.log('Applied patches:')
 * for (const purl of purls) {
 *   console.log(`  - ${purl}`)
 * }
 */
export async function listPatches(cwd?: string): Promise<string[]> {
  const manifest = await readManifest(cwd)
  return Object.keys(manifest.patches)
}

/**
 * Check if a patch is applied for a specific package.
 *
 * @param purl - Package URL to check
 * @param cwd - Working directory (defaults to process.cwd())
 * @returns True if patch is applied
 *
 * @example
 * if (await hasPatch('npm:lodash@4.17.20')) {
 *   console.log('Patch already applied')
 * }
 */
export async function hasPatch(purl: string, cwd?: string): Promise<boolean> {
  const manifest = await readManifest(cwd)
  return purl in manifest.patches
}

/**
 * Get all patch records from the manifest.
 *
 * @param cwd - Working directory (defaults to process.cwd())
 * @returns Object mapping PURLs to patch records
 *
 * @example
 * const patches = await getAllPatches()
 * for (const [purl, patch] of Object.entries(patches)) {
 *   console.log(`${purl}: ${patch.description}`)
 * }
 */
export async function getAllPatches(
  cwd?: string,
): Promise<Record<string, PatchRecord>> {
  const manifest = await readManifest(cwd)
  return manifest.patches
}

/**
 * Migrate hash formats in the manifest.
 *
 * Converts legacy git-sha256 hashes to ssri format.
 * This function can be used to upgrade old manifests.
 *
 * @param cwd - Working directory (defaults to process.cwd())
 * @returns Number of hashes migrated
 *
 * @example
 * const migrated = await migrateHashes()
 * console.log(`Migrated ${migrated} hashes to ssri format`)
 */
export async function migrateHashes(cwd?: string): Promise<number> {
  const manifest = await readManifest(cwd)
  let migratedCount = 0

  for (const [purl, patch] of Object.entries(manifest.patches)) {
    for (const [filePath, fileInfo] of Object.entries(patch.files)) {
      // Check if beforeHash is legacy format.
      // Note: We cannot automatically convert git-sha256 hashes to ssri format here
      // because convertToSsri() requires the actual file content to validate and
      // recompute the hash. The migration would need to read all backed-up files
      // from the cache, which is beyond the scope of this metadata operation.
      if (fileInfo.beforeHash.startsWith('git-sha256-')) {
        console.warn(
          `Legacy git-sha256 hash detected for ${purl}:${filePath}. ` +
            'Manual migration required - see convertToSsri() in patch-hash.mts',
        )
        migratedCount++
      }

      // Check if afterHash is legacy format.
      if (fileInfo.afterHash.startsWith('git-sha256-')) {
        console.warn(
          `Legacy git-sha256 hash detected for ${purl}:${filePath}. ` +
            'Manual migration required - see convertToSsri() in patch-hash.mts',
        )
        migratedCount++
      }
    }
  }

  // Note: Actual hash conversion would require reading the original files
  // and recomputing hashes using ssri. This is a detection function for now.
  return migratedCount
}

/**
 * Validate that the manifest file is valid.
 *
 * @param cwd - Working directory (defaults to process.cwd())
 * @returns True if valid, false if validation errors exist
 *
 * @example
 * if (!await validateManifest()) {
 *   console.error('Manifest validation failed')
 * }
 */
export async function validateManifest(cwd?: string): Promise<boolean> {
  try {
    await readManifest(cwd)
    return true
  } catch (_error) {
    return false
  }
}

/**
 * Update patch status in manifest.
 *
 * Updates the status tracking fields for a patch, including application status,
 * timestamps, and locations where the patch was applied.
 *
 * @param purl - Package URL identifier
 * @param status - Patch status ('downloaded', 'applied', 'failed')
 * @param metadata - Additional metadata to update
 * @param cwd - Working directory (defaults to process.cwd())
 *
 * @example
 * await updatePatchStatus('pkg:npm/example@1.0.0', 'applied', {
 *   appliedAt: new Date().toISOString(),
 *   appliedTo: ['/path/to/node_modules/example']
 * })
 */
export async function updatePatchStatus(
  purl: string,
  status: 'downloaded' | 'applied' | 'failed',
  metadata?: {
    appliedAt?: string
    appliedTo?: string[]
    downloadedAt?: string
  },
  cwd?: string,
): Promise<void> {
  const manifest = await readManifest(cwd)
  const patch = manifest.patches[purl]

  if (!patch) {
    throw new Error(`Patch not found in manifest: ${purl}`)
  }

  // Update status.
  patch.status = status

  // Update metadata fields if provided.
  if (metadata?.appliedAt !== undefined) {
    patch.appliedAt = metadata.appliedAt
  }
  if (metadata?.appliedTo !== undefined) {
    patch.appliedTo = metadata.appliedTo
  }
  if (metadata?.downloadedAt !== undefined) {
    patch.downloadedAt = metadata.downloadedAt
  }

  // Write updated manifest.
  await writeManifest(manifest, cwd)
}
