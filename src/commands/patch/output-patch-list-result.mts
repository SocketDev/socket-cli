import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { PatchListEntry } from './handle-patch-list.mts'
import type { CResult, OutputKind } from '../../types.mts'

type PatchListResultData = {
  patches: PatchListEntry[]
}

export async function outputPatchListResult(
  result: CResult<PatchListResultData>,
  outputKind: OutputKind,
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    return
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const { patches } = result.data

  if (outputKind === 'markdown') {
    if (patches.length === 0) {
      logger.log('## Patches\n\nNo patches found.')
      return
    }

    logger.log('## Patches\n')
    for (const patch of patches) {
      logger.log(`### ${patch.purl}\n`)
      if (patch.uuid) {
        logger.log(`**UUID**: ${patch.uuid}\n`)
      }
      if (patch.description) {
        logger.log(`**Description**: ${patch.description}\n`)
      }
      logger.log(`**Exported**: ${patch.exportedAt}`)
      logger.log(`**Files**: ${patch.fileCount}`)
      logger.log(`**Vulnerabilities**: ${patch.vulnerabilityCount}`)
      if (patch.tier) {
        logger.log(`**Tier**: ${patch.tier}`)
      }
      if (patch.license) {
        logger.log(`**License**: ${patch.license}`)
      }
      logger.log('')
    }
    return
  }

  // Default output.
  if (patches.length === 0) {
    return
  }

  logger.group('')
  for (const patch of patches) {
    logger.log(`- ${patch.purl}`)
    logger.group()
    if (patch.uuid) {
      logger.log(`UUID: ${patch.uuid}`)
    }
    if (patch.description) {
      logger.log(`Description: ${patch.description}`)
    }
    logger.log(`Exported: ${patch.exportedAt}`)
    logger.log(`Files: ${patch.fileCount}`)
    logger.log(`Vulnerabilities: ${patch.vulnerabilityCount}`)
    if (patch.tier) {
      logger.log(`Tier: ${patch.tier}`)
    }
    if (patch.license) {
      logger.log(`License: ${patch.license}`)
    }
    logger.groupEnd()
  }
  logger.groupEnd()
}
