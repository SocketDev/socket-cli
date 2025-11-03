import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { PatchRmData } from './handle-patch-rm.mts'
import type { CResult, OutputKind } from '../../types.mts'
const logger = getDefaultLogger()


export async function outputPatchRmResult(
  result: CResult<PatchRmData>,
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

  const { filesRestored, purl } = result.data

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
