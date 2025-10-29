import { logger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdError, mdHeader } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'

export async function outputFixResult(
  result: CResult<unknown>,
  outputKind: OutputKind,
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    return
  }

  if (outputKind === 'markdown') {
    if (!result.ok) {
      logger.log(mdError(result.message, result.cause))
    } else {
      logger.log(mdHeader('Fix Completed'))
      logger.log('')
      logger.log('✓ Finished!')
    }
    return
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  logger.log('')
  logger.success('Finished!')
}
