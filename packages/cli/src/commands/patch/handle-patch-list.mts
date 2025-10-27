import { promises as fs } from 'node:fs'
import path from 'node:path'

import { UTF8 } from '@socketsecurity/lib/constants/encoding'
import {
  DOT_SOCKET_DIR,
  MANIFEST_JSON,
} from '@socketsecurity/lib/constants/paths'
import { logger } from '@socketsecurity/lib/logger'
import { normalizePath } from '@socketsecurity/lib/path'
import { select } from '@socketsecurity/lib/prompts'
import { pluralize } from '@socketsecurity/lib/words'

import { handlePatchApply } from './handle-patch-apply.mts'
import { PatchManifestSchema } from './manifest-schema.mts'
import { outputPatchListResult } from './output-patch-list-result.mts'
import { getErrorCause } from '../../utils/error/errors.mjs'
import { getPurlObject } from '../../utils/purl/parse.mjs'

import type { OutputKind } from '../../types.mts'
import type { Spinner } from '@socketsecurity/lib/spinner'

export interface PatchListEntry {
  appliedAt: string | undefined
  description: string | undefined
  exportedAt: string
  fileCount: number
  license: string | undefined
  purl: string
  status: 'downloaded' | 'applied' | 'failed' | undefined
  tier: string | undefined
  uuid: string | undefined
  vulnerabilityCount: number
}

export interface HandlePatchListConfig {
  cwd: string
  interactive: boolean
  outputKind: OutputKind
  spinner: Spinner | null
}

export async function handlePatchList({
  cwd,
  interactive,
  outputKind,
  spinner,
}: HandlePatchListConfig): Promise<void> {
  try {
    spinner?.start('Reading patch manifest')

    const dotSocketDirPath = normalizePath(path.join(cwd, DOT_SOCKET_DIR))
    const manifestPath = normalizePath(
      path.join(dotSocketDirPath, MANIFEST_JSON),
    )
    const manifestContent = await fs.readFile(manifestPath, UTF8)
    const manifestData = JSON.parse(manifestContent)
    const validated = PatchManifestSchema.parse(manifestData)

    const patches: PatchListEntry[] = []

    for (const { 0: purl, 1: patch } of Object.entries(validated.patches)) {
      const fileCount = Object.keys(patch.files).length
      const vulnerabilityCount = Object.keys(patch.vulnerabilities || {}).length

      patches.push({
        appliedAt: patch.appliedAt,
        description: patch.description,
        exportedAt: patch.exportedAt,
        fileCount,
        license: patch.license,
        purl,
        status: patch.status,
        tier: patch.tier,
        uuid: patch.uuid,
        vulnerabilityCount,
      })
    }

    spinner?.stop()

    if (patches.length === 0) {
      if (outputKind === 'text') {
        logger.log('No patches found in manifest')
      }
      return
    }

    if (outputKind === 'text') {
      logger.log(
        `Found ${patches.length} ${pluralize('patch', { count: patches.length })} in manifest`,
      )
    }

    // Interactive mode: Let user select patches to apply.
    if (interactive) {
      if (patches.length === 0) {
        logger.log('No patches available to select')
        return
      }

      // Show list first.
      await outputPatchListResult(
        {
          ok: true,
          data: { patches },
        },
        outputKind,
      )

      logger.log('')
      logger.log('Select patches to apply (use arrow keys and Enter):')
      logger.log('')

      // Create choices for selection.
      const choices = [
        {
          name: '✓ Apply All Patches',
          value: '__ALL__',
        },
        ...patches.map(patch => {
          const statusIndicator =
            patch.status === 'applied'
              ? '[✓]'
              : patch.status === 'failed'
                ? '[✗]'
                : '[○]'
          const vulnText =
            patch.vulnerabilityCount > 0
              ? ` - ${patch.vulnerabilityCount} ${pluralize('vuln', { count: patch.vulnerabilityCount })}`
              : ''

          return {
            name: `${statusIndicator} ${patch.purl}${vulnText}`,
            value: patch.purl,
            description: patch.description || 'No description',
          }
        }),
        {
          name: '✗ Cancel',
          value: '__CANCEL__',
        },
      ]

      const selectedValue = await select({
        message: 'Select a patch to apply:',
        choices,
      })

      if (selectedValue === '__CANCEL__') {
        logger.log('Cancelled')
        return
      }

      // Determine which patches to apply.
      const purlsToApply: string[] = []

      if (selectedValue === '__ALL__') {
        purlsToApply.push(...patches.map(p => p.purl))
      } else {
        purlsToApply.push(selectedValue)
      }

      logger.log('')
      logger.log(
        `Applying ${purlsToApply.length} ${pluralize('patch', { count: purlsToApply.length })}...`,
      )
      logger.log('')

      // Convert PURLs to PackageURL objects.
      const purlObjs = purlsToApply
        .map(purl => getPurlObject(purl, { throws: false }))
        .filter((p): p is NonNullable<typeof p> => p !== null)

      // Apply the selected patches.
      await handlePatchApply({
        cwd,
        dryRun: false,
        outputKind,
        purlObjs,
        spinner,
      })

      return
    }

    // Non-interactive mode: Just show the list.
    await outputPatchListResult(
      {
        ok: true,
        data: { patches },
      },
      outputKind,
    )
  } catch (e) {
    spinner?.stop()

    let message = 'Failed to list patches'
    let cause = getErrorCause(e)

    if (e instanceof SyntaxError) {
      message = `Invalid JSON in ${MANIFEST_JSON}`
      cause = e.message
    } else if (e instanceof Error && 'issues' in e) {
      message = 'Schema validation failed'
      cause = String(e)
    }

    await outputPatchListResult(
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
