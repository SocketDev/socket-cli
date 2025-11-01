import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader } from '../../utils/output/markdown.mts'
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
    getDefaultLogger().log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  if (outputKind === 'markdown') {
    getDefaultLogger().log(mdHeader('Quota'))
    getDefaultLogger().log('')
    getDefaultLogger().log(
      `Quota left on the current API token: ${result.data.quota}`,
    )
    getDefaultLogger().log('')
    return
  }

  getDefaultLogger().log(
    `Quota left on the current API token: ${result.data.quota}`,
  )
  getDefaultLogger().log('')
}
