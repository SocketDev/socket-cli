import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { PatchCleanupData } from './handle-patch-cleanup.mts'
import type { CResult, OutputKind } from '../../types.mts'

export async function outputPatchCleanupResult(
  result: CResult<PatchCleanupData>,
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

  const { cleaned } = result.data

  if (outputKind === 'markdown') {
    getDefaultLogger().log('## Patch Backups Cleaned\n')
    getDefaultLogger().log(`**Count**: ${cleaned.length}\n`)
    if (cleaned.length > 0) {
      getDefaultLogger().log('**UUIDs**:\n')
      for (const uuid of cleaned) {
        getDefaultLogger().log(`- ${uuid}`)
      }
    }
    return
  }

  // Default output.
  if (cleaned.length === 0) {
    return
  }

  getDefaultLogger().group('')
  getDefaultLogger().log(`Cleaned backups: ${cleaned.length}`)
  if (cleaned.length > 0) {
    getDefaultLogger().group()
    for (const uuid of cleaned) {
      getDefaultLogger().log(`- ${uuid}`)
    }
    getDefaultLogger().groupEnd()
  }
  getDefaultLogger().groupEnd()
}
