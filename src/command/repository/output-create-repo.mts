import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { failMsgWithBadge } from '../../util/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../util/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk-stable'
const logger = getDefaultLogger()

export function outputCreateRepo(
  result: CResult<SocketSdkSuccessResult<'createRepository'>['data']>,
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
