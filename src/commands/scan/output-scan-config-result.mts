import { logger } from '@socketsecurity/lib/logger'
import type { CResult } from '../../types.mts'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'

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
