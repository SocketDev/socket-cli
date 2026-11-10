import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { logger } from '../../utils/logger.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'

export async function outputConfigSet(
  result: CResult<undefined | string>,
  outputKind: OutputKind,
) {
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

  if (outputKind === 'markdown') {
    logger.log(`# Update config`)
    logger.log('')
    logger.log(result.message)
    return
  }

  logger.log(`OK`)
  logger.log(result.message)
}
