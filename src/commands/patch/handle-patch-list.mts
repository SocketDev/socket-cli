import { promises as fs } from 'node:fs'
import path from 'node:path'

import { UTF8 } from '@socketsecurity/registry/constants/encoding'
import { DOT_SOCKET_DIR, MANIFEST_JSON } from '@socketsecurity/registry/constants/paths'
import { logger } from '@socketsecurity/registry/lib/logger'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { pluralize } from '@socketsecurity/registry/lib/words'


import { PatchManifestSchema } from './manifest-schema.mts'
import { outputPatchListResult } from './output-patch-list-result.mts'
import { getErrorCause } from '../../utils/error/errors.mjs'

import type { OutputKind } from '../../types.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export interface PatchListEntry {
  description: string | undefined
  exportedAt: string
  fileCount: number
  license: string | undefined
  purl: string
  tier: string | undefined
  uuid: string | undefined
  vulnerabilityCount: number
}

export interface HandlePatchListConfig {
  cwd: string
  outputKind: OutputKind
  spinner: Spinner
}

export async function handlePatchList({
  cwd,
  outputKind,
  spinner,
}: HandlePatchListConfig): Promise<void> {
  try {
    spinner.start('Reading patch manifest')

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
      const vulnerabilityCount = Object.keys(
        patch.vulnerabilities || {},
      ).length

      patches.push({
        description: patch.description,
        exportedAt: patch.exportedAt,
        fileCount,
        license: patch.license,
        purl,
        tier: patch.tier,
        uuid: patch.uuid,
        vulnerabilityCount,
      })
    }

    spinner.stop()

    if (patches.length === 0) {
      logger.log('No patches found in manifest')
    } else {
      logger.log(
        `Found ${patches.length} ${pluralize('patch', { count: patches.length })} in manifest`,
      )
    }

    await outputPatchListResult(
      {
        ok: true,
        data: { patches },
      },
      outputKind,
    )
  } catch (e) {
    spinner.stop()

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
