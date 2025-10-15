import { logger } from '@socketsecurity/registry/lib/logger'

import { OUTPUT_JSON } from '../../constants.mts'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { PatchRmData } from './handle-patch-rm.mts'
import type { CResult, OutputKind } from '../../types.mts'

export async function outputPatchRmResult(
  result: CResult<PatchRmData>,
  outputKind: OutputKind,
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === OUTPUT_JSON) {
    logger.log(serializeResultJson(result))
    return
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const { filesRestored, purl } = result.data

  if (outputKind === 'json') {
    logger.log(JSON.stringify({ filesRestored, purl }, null, 2))
    return
  }

  if (outputKind === 'markdown') {
    logger.log('## Patch Removed\n')
    logger.log(`**PURL**: ${purl}`)
    logger.log(`**Files Restored**: ${filesRestored}`)
    return
  }

  // Default output.
  logger.group('')
  logger.log(`PURL: ${purl}`)
  logger.log(`Files restored: ${filesRestored}`)
  logger.groupEnd()
}
