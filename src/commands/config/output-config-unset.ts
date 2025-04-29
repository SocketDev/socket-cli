import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge'
import { serializeResultJson } from '../../utils/serialize-result-json'

import type { CResult, OutputKind } from '../../types'

export async function outputConfigUnset(
  updateResult: CResult<undefined | string>,
  outputKind: OutputKind
) {
  if (!updateResult.ok) {
    process.exitCode = updateResult.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(updateResult))
  } else if (!updateResult.ok) {
    logger.fail(failMsgWithBadge(updateResult.message, updateResult.cause))
  } else if (outputKind === 'markdown') {
    logger.log(`# Update config`)
    logger.log('')
    logger.log(updateResult.message)
    if (updateResult.message) {
      logger.log('')
      logger.log(updateResult.message)
    }
  } else {
    logger.log(`OK`)
    if (updateResult.message) {
      logger.log('')
      logger.log(updateResult.message)
    }
  }
}
