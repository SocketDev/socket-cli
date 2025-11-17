import { promises as fs } from 'node:fs'
import path from 'node:path'

import { UTF8 } from '@socketsecurity/lib/constants/encoding'
import { DOT_SOCKET_DIR } from '@socketsecurity/lib/paths/dirnames'
import { MANIFEST_JSON } from '@socketsecurity/lib/paths/filenames'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'

import { PatchManifestSchema } from './manifest-schema.mts'
import { outputPatchInfoResult } from './output-patch-info-result.mts'
import { getErrorCause, InputError } from '../../utils/error/errors.mjs'
import { normalizePurl } from '../../utils/purl/parse.mjs'

import type { PatchRecord } from './manifest-schema.mts'
import type { OutputKind } from '../../types.mts'
import type { Spinner } from '@socketsecurity/lib/spinner'

export interface PatchInfoData {
  description: string | undefined
  exportedAt: string
  files: Record<string, { afterHash: string; beforeHash: string }>
  license: string | undefined
  purl: string
  tier: string | undefined
  uuid: string | undefined
  vulnerabilities: PatchRecord['vulnerabilities']
}

export interface HandlePatchInfoConfig {
  cwd: string
  outputKind: OutputKind
  purl: string
  spinner: Spinner | null
}

export async function handlePatchInfo({
  cwd,
  outputKind,
  purl,
  spinner,
}: HandlePatchInfoConfig): Promise<void> {
  try {
    spinner?.start('Reading patch manifest')

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
      spinner?.stop()
      throw new InputError(`Patch not found for PURL: ${purl}`)
    }

    spinner?.stop()

    if (outputKind === 'text') {
      const logger = getDefaultLogger()
      logger.log(`Patch information for: ${normalizedPurl}`)
    }

    const patchInfo: PatchInfoData = {
      description: patch.description,
      exportedAt: patch.exportedAt,
      files: patch.files,
      license: patch.license,
      purl: normalizedPurl,
      tier: patch.tier,
      uuid: patch.uuid,
      vulnerabilities: patch.vulnerabilities,
    }

    await outputPatchInfoResult(
      {
        ok: true,
        data: patchInfo,
      },
      outputKind,
    )
  } catch (e) {
    spinner?.stop()

    if (e instanceof InputError) {
      throw e
    }

    let message = 'Failed to get patch info'
    let cause = getErrorCause(e)

    if (e instanceof SyntaxError) {
      message = `Invalid JSON in ${MANIFEST_JSON}`
      cause = e.message
    } else if (e instanceof Error && 'issues' in e) {
      message = 'Schema validation failed'
      cause = String(e)
    }

    await outputPatchInfoResult(
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
