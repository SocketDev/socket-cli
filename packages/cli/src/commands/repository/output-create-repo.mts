import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export function outputCreateRepo(
  result: CResult<SocketSdkSuccessResult<'createRepository'>['data']>,
  requestedName: string,
  outputKind: OutputKind,
): void {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }
  if (outputKind === 'json') {
    getDefaultLogger().log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }
  const { slug } = result.data
  getDefaultLogger().success(
    `OK. Repository created successfully, slug: \`${slug}\`${slug !== requestedName ? ' (Warning: slug is not the same as name that was requested!)' : ''}`,
  )
}
