import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdError, mdHeader } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'

export async function outputFixResult(
  result: CResult<unknown>,
  outputKind: OutputKind,
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    getDefaultLogger().log(serializeResultJson(result))
    return
  }

  if (outputKind === 'markdown') {
    if (!result.ok) {
      getDefaultLogger().log(mdError(result.message, result.cause))
    } else {
      getDefaultLogger().log(mdHeader('Fix Completed'))
      getDefaultLogger().log('')
      getDefaultLogger().log('✓ Finished!')
    }
    return
  }

  if (!result.ok) {
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  getDefaultLogger().log('')
  getDefaultLogger().success('Finished!')
}
