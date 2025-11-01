import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { PatchRmData } from './handle-patch-rm.mts'
import type { CResult, OutputKind } from '../../types.mts'

export async function outputPatchRmResult(
  result: CResult<PatchRmData>,
  outputKind: OutputKind,
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

  const { filesRestored, purl } = result.data

  if (outputKind === 'markdown') {
    getDefaultLogger().log('## Patch Removed\n')
    getDefaultLogger().log(`**PURL**: ${purl}`)
    getDefaultLogger().log(`**Files Restored**: ${filesRestored}`)
    return
  }

  // Default output.
  getDefaultLogger().group('')
  getDefaultLogger().log(`PURL: ${purl}`)
  getDefaultLogger().log(`Files restored: ${filesRestored}`)
  getDefaultLogger().groupEnd()
}
