import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'

export async function outputConfigUnset(
  updateResult: CResult<undefined | string>,
  outputKind: OutputKind,
) {
  if (!updateResult.ok) {
    process.exitCode = updateResult.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(updateResult))
    return
  }
  if (!updateResult.ok) {
    logger.fail(failMsgWithBadge(updateResult.message, updateResult.cause))
    return
  }

  if (outputKind === 'markdown') {
    logger.log(`# Update config`)
    logger.log('')
    logger.log(updateResult.message)
    if (updateResult.data) {
      logger.log('')
      logger.log(updateResult.data)
    }
  } else {
    logger.log(`OK`)
    logger.log(updateResult.message)
    if (updateResult.data) {
      logger.log('')
      logger.log(updateResult.data)
    }
  }
}
