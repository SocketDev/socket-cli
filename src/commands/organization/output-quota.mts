import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputQuota(
  result: CResult<SocketSdkReturnType<'getQuota'>['data']>,
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
