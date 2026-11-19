import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { logger } from '../../utils/logger.mts'

import type { CResult } from '../../types.mts'

export async function outputScanConfigResult(result: CResult<unknown>) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  logger.log('')
  logger.log('Finished')
  logger.log('')
}
