import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import { failMsgWithBadge } from '../../util/error/fail-msg-with-badge.mts'

import type { CResult } from '../../types.mts'
const logger = getDefaultLogger()

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
