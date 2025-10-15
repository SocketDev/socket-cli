import { promises as fs } from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { PatchManifestSchema } from './manifest-schema.mts'
import { outputPatchRmResult } from './output-patch-rm-result.mts'
import { DOT_SOCKET_DIR, MANIFEST_JSON, UTF8 } from '../../constants.mts'
import { getErrorCause, InputError } from '../../utils/error/errors.mjs'
import {
  cleanupBackups,
  getPatchMetadata,
  restoreAllBackups,
} from '../../utils/manifest/patches/backup.mts'
import { removePatch } from '../../utils/manifest/patches/index.mts'
import { normalizePurl } from '../../utils/purl/parse.mjs'

import type { OutputKind } from '../../types.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export interface PatchRmData {
  filesRestored: number
  purl: string
}

export interface HandlePatchRmConfig {
  cwd: string
  keepBackups: boolean
  outputKind: OutputKind
  purl: string
  spinner: Spinner
}

export async function handlePatchRm({
  cwd,
  keepBackups,
  outputKind,
  purl,
  spinner,
}: HandlePatchRmConfig): Promise<void> {
  try {
    spinner.start('Reading patch manifest')

    const dotSocketDirPath = normalizePath(path.join(cwd, DOT_SOCKET_DIR))
    const manifestPath = normalizePath(
      path.join(dotSocketDirPath, MANIFEST_JSON),
    )
    const manifestContent = await fs.readFile(manifestPath, UTF8)
    const manifestData = JSON.parse(manifestContent)
    const validated = PatchManifestSchema.parse(manifestData)

    const normalizedPurl = normalizePurl(purl)
    const patch = validated.patches[normalizedPurl]

    if (!patch) {
      spinner.stop()
      throw new InputError(`Patch not found for PURL: ${purl}`)
    }

    // Check if patch has backups.
    const uuid = patch.uuid
    if (!uuid) {
      spinner.stop()
      throw new InputError('Patch does not have a UUID for backup restoration')
    }

    spinner.text = 'Checking for backups'

    const metadata = await getPatchMetadata(uuid)
    if (!metadata) {
      spinner.stop()
      logger.warn(
        'No backups found for this patch. Original files cannot be restored.',
      )
      logger.log('Removing patch from manifest only.')
    }

    let filesRestored = 0

    if (metadata) {
      spinner.text = 'Restoring original files from backups'

      // Restore all backed up files.
      const restoreResults = await restoreAllBackups(uuid, cwd)

      filesRestored = restoreResults.filter(r => r.restored).length
      const failed = restoreResults.filter(r => !r.restored)

      if (failed.length > 0) {
        spinner.stop()
        logger.warn(
          `Failed to restore ${failed.length} ${pluralize('file', { count: failed.length })}:`,
        )
        for (const { error, filePath } of failed) {
          logger.log(`  - ${filePath}: ${error}`)
        }
      }

      if (!keepBackups) {
        spinner.text = 'Cleaning up backups'
        await cleanupBackups(uuid)
      }
    }

    spinner.text = 'Removing patch from manifest'

    // Remove patch from manifest.
    await removePatch(normalizedPurl, cwd)

    spinner.stop()

    logger.log(`Removed patch for ${normalizedPurl}`)
    if (filesRestored > 0) {
      logger.log(
        `Restored ${filesRestored} ${pluralize('file', { count: filesRestored })} from backups`,
      )
    }

    await outputPatchRmResult(
      {
        ok: true,
        data: {
          filesRestored,
          purl: normalizedPurl,
        },
      },
      outputKind,
    )
  } catch (e) {
    spinner.stop()

    if (e instanceof InputError) {
      throw e
    }

    let message = 'Failed to remove patch'
    let cause = getErrorCause(e)

    if (e instanceof SyntaxError) {
      message = `Invalid JSON in ${MANIFEST_JSON}`
      cause = e.message
    } else if (e instanceof Error && 'issues' in e) {
      message = 'Schema validation failed'
      cause = String(e)
    }

    await outputPatchRmResult(
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
