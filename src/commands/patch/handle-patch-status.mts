import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { UTF8 } from '@socketsecurity/lib/constants/encoding'
import {
  DOT_SOCKET_DIR,
  MANIFEST_JSON,
  NODE_MODULES,
} from '@socketsecurity/lib/constants/paths'
import { logger } from '@socketsecurity/lib/logger'
import { normalizePath } from '@socketsecurity/lib/path'
import { pluralize } from '@socketsecurity/lib/words'

import { PatchManifestSchema } from './manifest-schema.mts'
import { outputPatchStatusResult } from './output-patch-status-result.mts'
import { getErrorCause } from '../../utils/error/errors.mjs'
import { findUp } from '../../utils/fs/fs.mjs'
import { hasBackupForPatch } from '../../utils/manifest/patch-backup.mts'

import type { PatchRecord } from './manifest-schema.mts'
import type { OutputKind } from '../../types.mts'
import type { Spinner } from '@socketsecurity/lib/spinner'

export interface PatchStatus {
  appliedAt: string | undefined
  appliedLocations: string[]
  backupAvailable: boolean
  description: string | undefined
  downloadedAt: string | undefined
  fileCount: number
  purl: string
  status: 'downloaded' | 'applied' | 'failed' | 'unknown'
  uuid: string | undefined
  vulnerabilityCount: number
}

export interface HandlePatchStatusConfig {
  cwd: string
  filters: {
    applied: boolean
    downloaded: boolean
    failed: boolean
  }
  outputKind: OutputKind
  spinner: Spinner
}

/**
 * Compute SHA256 hash of file contents.
 */
async function computeSHA256(filepath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filepath)
    const hash = crypto.createHash('sha256')
    hash.update(content)
    return hash.digest('hex')
  } catch (_e) {
    return null
  }
}

/**
 * Find all locations where a package exists in node_modules.
 */
async function findPackageLocations(
  cwd: string,
  packageName: string,
): Promise<string[]> {
  const locations: string[] = []

  const rootNmPath = await findUp(NODE_MODULES, { cwd, onlyDirectories: true })
  if (!rootNmPath) {
    return locations
  }

  // Check root node_modules.
  const rootPkgPath = normalizePath(path.join(rootNmPath, packageName))
  if (existsSync(rootPkgPath)) {
    locations.push(rootPkgPath)
  }

  // TODO: Recursively check nested node_modules if needed.
  // For now, just check the root level.

  return locations
}

/**
 * Verify if a patch is actually applied by checking file hashes.
 */
async function verifyPatchApplied(
  pkgPath: string,
  patch: PatchRecord,
): Promise<boolean> {
  let allMatch = true

  for (const { 0: fileName, 1: fileInfo } of Object.entries(patch.files)) {
    const filePath = normalizePath(path.join(pkgPath, fileName))

    if (!existsSync(filePath)) {
      return false
    }

    // eslint-disable-next-line no-await-in-loop
    const currentHash = await computeSHA256(filePath)

    if (currentHash !== fileInfo.afterHash) {
      allMatch = false
      break
    }
  }

  return allMatch
}

/**
 * Determine the actual status of a patch by checking the filesystem.
 */
async function determinePatchStatus(
  cwd: string,
  purl: string,
  patch: PatchRecord,
): Promise<{
  appliedLocations: string[]
  backupAvailable: boolean
  status: 'downloaded' | 'applied' | 'failed' | 'unknown'
}> {
  // Extract package name from PURL.
  // Format: pkg:npm/package-name@version.
  const match = purl.match(/pkg:npm\/([^@]+)/)
  if (!match) {
    return {
      appliedLocations: [],
      backupAvailable: false,
      status: 'unknown',
    }
  }

  const packageName = match[1]!
  const locations = await findPackageLocations(cwd, packageName)

  if (locations.length === 0) {
    // Package not found in node_modules.
    return {
      appliedLocations: [],
      backupAvailable: patch.uuid ? await hasBackupForPatch(patch.uuid) : false,
      status: patch.status || 'downloaded',
    }
  }

  // Check if patch is applied in any location.
  const appliedLocations: string[] = []

  for (const location of locations) {
    // eslint-disable-next-line no-await-in-loop
    const isApplied = await verifyPatchApplied(location, patch)
    if (isApplied) {
      appliedLocations.push(location)
    }
  }

  let backupAvailable = false
  if (patch.uuid) {
    backupAvailable = await hasBackupForPatch(patch.uuid)
  }

  if (appliedLocations.length > 0) {
    return {
      appliedLocations,
      backupAvailable,
      status: 'applied',
    }
  }

  // Package exists but patch not applied.
  return {
    appliedLocations: [],
    backupAvailable,
    status: patch.status || 'downloaded',
  }
}

export async function handlePatchStatus({
  cwd,
  filters,
  outputKind,
  spinner,
}: HandlePatchStatusConfig): Promise<void> {
  try {
    spinner.start('Reading patch manifest')

    const dotSocketDirPath = normalizePath(path.join(cwd, DOT_SOCKET_DIR))
    const manifestPath = normalizePath(
      path.join(dotSocketDirPath, MANIFEST_JSON),
    )
    const manifestContent = await fs.readFile(manifestPath, UTF8)
    const manifestData = JSON.parse(manifestContent)
    const validated = PatchManifestSchema.parse(manifestData)

    spinner.text('Checking patch status')

    const statuses: PatchStatus[] = []

    for (const { 0: purl, 1: patch } of Object.entries(validated.patches)) {
      const { appliedLocations, backupAvailable, status } =
        // eslint-disable-next-line no-await-in-loop
        await determinePatchStatus(cwd, purl, patch)

      const fileCount = Object.keys(patch.files).length
      const vulnerabilityCount = Object.keys(patch.vulnerabilities || {}).length

      statuses.push({
        appliedAt: patch.appliedAt,
        appliedLocations,
        backupAvailable,
        description: patch.description,
        downloadedAt: patch.downloadedAt,
        fileCount,
        purl,
        status,
        uuid: patch.uuid,
        vulnerabilityCount,
      })
    }

    spinner.stop()

    // Apply filters.
    let filteredStatuses = statuses

    if (filters.applied) {
      filteredStatuses = filteredStatuses.filter(s => s.status === 'applied')
    } else if (filters.downloaded) {
      filteredStatuses = filteredStatuses.filter(s => s.status === 'downloaded')
    } else if (filters.failed) {
      filteredStatuses = filteredStatuses.filter(s => s.status === 'failed')
    }

    if (statuses.length === 0) {
      logger.log('No patches found in manifest')
    } else if (filteredStatuses.length === 0) {
      logger.log('No patches match the filter criteria')
    } else {
      logger.log(
        `Found ${filteredStatuses.length} ${pluralize('patch', { count: filteredStatuses.length })}`,
      )
    }

    await outputPatchStatusResult(
      {
        ok: true,
        data: { statuses: filteredStatuses },
      },
      outputKind,
    )
  } catch (e) {
    spinner.stop()

    let message = 'Failed to get patch status'
    let cause = getErrorCause(e)

    if (e instanceof SyntaxError) {
      message = `Invalid JSON in ${MANIFEST_JSON}`
      cause = e.message
    } else if (e instanceof Error && 'issues' in e) {
      message = 'Schema validation failed'
      cause = String(e)
    }

    await outputPatchStatusResult(
      {
        ok: false,
        code: 1,
        message,
        cause,
      },
      outputKind,
    )
  }
}
