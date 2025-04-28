import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge'
import { serializeResultJson } from '../../utils/serialize-result-json'

import type { CResult, OutputKind } from '../../types'

export async function outputConfigUnset(
  updateResult: CResult<undefined | string>,
  outputKind: OutputKind
) {
  if (outputKind === 'json') {
    logger.log(JSON.stringify(serializeResultJson(updateResult)))
  } else if (outputKind === 'markdown') {
    logger.log(`# Update config`)
    logger.log('')
    logger.log(updateResult.message)
    if (!updateResult.ok) {
      logger.log('')
      logger.log(updateResult.data)
    }
  } else if (updateResult.ok) {
    logger.log(`OK`)
  } else {
    logger.log(failMsgWithBadge(updateResult.message, updateResult.cause))
  }
}
