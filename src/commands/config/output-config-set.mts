import { logger } from '@socketsecurity/lib/logger'
import type { CResult, OutputKind } from '../../types.mts'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

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
    logger.log('# Update config')
    logger.log('')
    logger.log(result.message)
    if (result.data) {
      logger.log('')
      logger.log(result.data)
    }
  } else {
    logger.log('OK')
    logger.log(result.message)
    if (result.data) {
      logger.log('')
      logger.log(result.data)
    }
  }
}
