import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'

export async function outputConfigSet(
  result: CResult<undefined | string>,
  outputKind: OutputKind,
) {
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
    getDefaultLogger().log(mdHeader('Update config'))
    getDefaultLogger().log('')
    getDefaultLogger().log(result.message)
    if (result.data) {
      getDefaultLogger().log('')
      getDefaultLogger().log(result.data)
    }
  } else {
    getDefaultLogger().log('OK')
    getDefaultLogger().log(result.message)
    if (result.data) {
      getDefaultLogger().log('')
      getDefaultLogger().log(result.data)
    }
  }
}
