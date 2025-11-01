import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'

export async function outputConfigUnset(
  updateResult: CResult<undefined | string>,
  outputKind: OutputKind,
) {
  if (!updateResult.ok) {
    process.exitCode = updateResult.code ?? 1
  }

  if (outputKind === 'json') {
    getDefaultLogger().log(serializeResultJson(updateResult))
    return
  }
  if (!updateResult.ok) {
    getDefaultLogger().fail(
      failMsgWithBadge(updateResult.message, updateResult.cause),
    )
    return
  }

  if (outputKind === 'markdown') {
    getDefaultLogger().log(mdHeader('Update config'))
    getDefaultLogger().log('')
    getDefaultLogger().log(updateResult.message)
    if (updateResult.data) {
      getDefaultLogger().log('')
      getDefaultLogger().log(updateResult.data)
    }
  } else {
    getDefaultLogger().log('OK')
    getDefaultLogger().log(updateResult.message)
    if (updateResult.data) {
      getDefaultLogger().log('')
      getDefaultLogger().log(updateResult.data)
    }
  }
}
