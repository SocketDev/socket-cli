import { getDefaultLogger } from '@socketsecurity/lib-internal/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { PatchCleanupData } from './handle-patch-cleanup.mts'
import type { CResult, OutputKind } from '../../types.mts'
const logger = getDefaultLogger()

export async function outputPatchCleanupResult(
  result: CResult<PatchCleanupData>,
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

  const { cleaned } = result.data

  if (outputKind === 'markdown') {
    logger.log('## Patch Backups Cleaned\n')
    logger.log(`**Count**: ${cleaned.length}\n`)
    if (cleaned.length > 0) {
      logger.log('**UUIDs**:\n')
      for (const uuid of cleaned) {
        logger.log(`- ${uuid}`)
      }
    }
    return
  }

  // Default output.
  if (cleaned.length === 0) {
    return
  }

  logger.group('')
  logger.log(`Cleaned backups: ${cleaned.length}`)
  if (cleaned.length > 0) {
    logger.group()
    for (const uuid of cleaned) {
      logger.log(`- ${uuid}`)
    }
    logger.groupEnd()
  }
  logger.groupEnd()
}
