import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import { failMsgWithBadge } from '../../util/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../util/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk-stable'
const logger = getDefaultLogger()

export async function outputDeleteScan(
  result: CResult<SocketSdkSuccessResult<'deleteFullScan'>['data']>,
  outputKind: OutputKind,
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

  logger.success('Scan deleted successfully')
}
