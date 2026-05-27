import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { failMsgWithBadge } from '../../util/error/fail-msg-with-badge.mts'
import { mdError, mdHeader } from '../../util/output/markdown.mts'
import { serializeResultJson } from '../../util/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
const logger = getDefaultLogger()

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
      logger.success('Finished!')
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
