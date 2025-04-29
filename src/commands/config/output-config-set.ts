import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge'
import { serializeResultJson } from '../../utils/serialize-result-json'

import type { CResult, OutputKind } from '../../types'

export async function outputConfigSet(
  result: CResult<undefined | string>,
  outputKind: OutputKind
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
    if (result.data) {
      logger.log('')
      logger.log(result.data)
    }
  } else {
    logger.log(`OK`)
    logger.log(result.message)
    if (result.data) {
      logger.log('')
      logger.log(result.data)
    }
  }
}
