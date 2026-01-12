import { promises as fs } from 'node:fs'
import path from 'node:path'

import { UTF8 } from '@socketsecurity/lib/constants/encoding'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { DOT_SOCKET_DIR } from '@socketsecurity/lib/paths/dirnames'
import { MANIFEST_JSON } from '@socketsecurity/lib/paths/filenames'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'
import { pluralize } from '@socketsecurity/lib/words'

import { PatchManifestSchema } from './manifest-schema.mts'
import { outputPatchCleanupResult } from './output-patch-cleanup-result.mts'
import { getErrorCause } from '../../utils/error/errors.mjs'
import {
  cleanupBackups,
  listAllPatches,
} from '../../utils/manifest/patch-backup.mts'

import type { OutputKind } from '../../types.mts'
import type { Spinner } from '@socketsecurity/lib/spinner'
const logger = getDefaultLogger()

export interface PatchCleanupData {
  cleaned: string[]
}

export interface HandlePatchCleanupConfig {
  all: boolean
  cwd: string
  outputKind: OutputKind
  spinner: Spinner | null
  uuid: string | undefined
}

export async function handlePatchCleanup({
  all,
  cwd,
  outputKind,
  spinner,
  uuid,
}: HandlePatchCleanupConfig): Promise<void> {
  try {
    const cleaned: string[] = []

    if (uuid) {
      // Clean up specific UUID.
      spinner?.start(`Cleaning up backups for ${uuid}`)
      await cleanupBackups(uuid)
      cleaned.push(uuid)
      spinner?.stop()
      if (outputKind === 'text') {
        logger.log(`Cleaned up backups for ${uuid}`)
      }
    } else if (all) {
      // Clean up all backups.
      spinner?.start('Finding all patch backups')
      const allPatchUuids = await listAllPatches()

      if (allPatchUuids.length === 0) {
        spinner?.stop()
        if (outputKind === 'text') {
          logger.log('No patch backups found')
        }
      } else {
        spinner?.text(
          `Cleaning up ${allPatchUuids.length} ${pluralize('patch', { count: allPatchUuids.length })}`,
        )

        for (const patchUuid of allPatchUuids) {
          // eslint-disable-next-line no-await-in-loop
          await cleanupBackups(patchUuid)
          cleaned.push(patchUuid)
        }

        spinner?.stop()
        if (outputKind === 'text') {
          logger.log(
            `Cleaned up backups for ${cleaned.length} ${pluralize('patch', { count: cleaned.length })}`,
          )
        }
      }
    } else {
      // Clean up orphaned backups (not in manifest).
      spinner?.start('Reading patch manifest')

      const dotSocketDirPath = normalizePath(path.join(cwd, DOT_SOCKET_DIR))
      const manifestPath = normalizePath(
        path.join(dotSocketDirPath, MANIFEST_JSON),
      )
      const manifestContent = await fs.readFile(manifestPath, UTF8)
      const manifestData = JSON.parse(manifestContent)
      const validated = PatchManifestSchema.parse(manifestData)

      // Get UUIDs from manifest.
      const manifestUuids = new Set<string>()
      for (const patch of Object.values(validated.patches)) {
        if (patch.uuid) {
          manifestUuids.add(patch.uuid)
        }
      }

      spinner?.text('Finding all patch backups')
      const allPatchUuids = await listAllPatches()

      // Find orphaned UUIDs (in backups but not in manifest).
      const orphanedUuids = allPatchUuids.filter(
        patchUuid => !manifestUuids.has(patchUuid),
      )

      if (orphanedUuids.length === 0) {
        spinner?.stop()
        if (outputKind === 'text') {
          logger.log('No orphaned patch backups found')
        }
      } else {
        spinner?.text(
          `Cleaning up ${orphanedUuids.length} orphaned ${pluralize('backup', { count: orphanedUuids.length })}`,
        )

        for (const patchUuid of orphanedUuids) {
          // eslint-disable-next-line no-await-in-loop
          await cleanupBackups(patchUuid)
          cleaned.push(patchUuid)
        }

        spinner?.stop()
        if (outputKind === 'text') {
          logger.log(
            `Cleaned up ${cleaned.length} orphaned ${pluralize('backup', { count: cleaned.length })}`,
          )
        }
      }
    }

    await outputPatchCleanupResult(
      {
        ok: true,
        data: { cleaned },
      },
      outputKind,
    )
  } catch (e) {
    spinner?.stop()

    let message = 'Failed to clean up patch backups'
    let cause = getErrorCause(e)

    if (e instanceof SyntaxError) {
      message = `Invalid JSON in ${MANIFEST_JSON}`
      cause = e.message
    } else if (e instanceof Error && 'issues' in e) {
      message = 'Schema validation failed'
      cause = String(e)
    }

    await outputPatchCleanupResult(
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
