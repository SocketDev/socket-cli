import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'

export async function outputScanGithub(
  result: CResult<unknown>,
  outputKind: OutputKind,
) {
  if (outputKind === 'json') {
    getDefaultLogger().log(serializeResultJson(result))
    return
  }

  if (!result.ok) {
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  getDefaultLogger().log('')
  getDefaultLogger().success('Finished!')
}
