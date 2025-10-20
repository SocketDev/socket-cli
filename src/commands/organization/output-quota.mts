import { logger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputQuota(
  result: CResult<SocketSdkSuccessResult<'getQuota'>['data']>,
  outputKind: OutputKind = 'text',
): Promise<void> {
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
    logger.log('# Quota')
    logger.log('')
    logger.log(`Quota left on the current API token: ${result.data.quota}`)
    logger.log('')
    return
  }

  logger.log(`Quota left on the current API token: ${result.data.quota}`)
  logger.log('')
}
