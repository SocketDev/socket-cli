import { logger } from '@socketsecurity/registry/lib/logger'

import { CResult, OutputKind } from '../../types'
import { serializeResultJson } from '../../utils/serialize-result-json'

export async function outputConfigSet(
  result: CResult<undefined | string>,
  outputKind: OutputKind
) {
  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
  } else if (outputKind === 'markdown') {
    logger.log(`# Update config`)
    logger.log('')
    logger.log(result.message)
    if (result.data) {
      logger.log('')
      logger.log(result.data)
    }
  } else {
    logger.log(`OK`)
    if (result.data) {
      logger.log('')
      logger.log(result.data)
    }
  }
}
