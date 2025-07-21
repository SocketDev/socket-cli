import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export function outputCreateRepo(
  result: CResult<SocketSdkSuccessResult<'createOrgRepo'>['data']>,
  requestedName: string,
  outputKind: OutputKind,
): void {
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
  const { slug } = result.data
  logger.success(
    `OK. Repository created successfully, slug: \`${slug}\`${slug !== requestedName ? ' (Warning: slug is not the same as name that was requested!)' : ''}`,
  )
}
