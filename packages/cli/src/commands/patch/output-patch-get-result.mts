import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { PatchGetData } from './handle-patch-get.mts'
import type { CResult, OutputKind } from '../../types.mts'

export async function outputPatchGetResult(
  result: CResult<PatchGetData>,
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

  const { files, outputDir, purl } = result.data

  if (outputKind === 'markdown') {
    getDefaultLogger().log('## Patch Files Retrieved\n')
    getDefaultLogger().log(`**PURL**: ${purl}`)
    getDefaultLogger().log(`**Output Directory**: ${outputDir}`)
    getDefaultLogger().log(`**Files**: ${files.length}\n`)
    for (const file of files) {
      getDefaultLogger().log(`- ${file}`)
    }
    return
  }

  // Default output.
  getDefaultLogger().group('')
  getDefaultLogger().log(`PURL: ${purl}`)
  getDefaultLogger().log(`Output directory: ${outputDir}`)
  getDefaultLogger().log(`Files copied: ${files.length}`)
  if (files.length > 0) {
    getDefaultLogger().group()
    for (const file of files) {
      getDefaultLogger().log(`- ${file}`)
    }
    getDefaultLogger().groupEnd()
  }
  getDefaultLogger().groupEnd()
}
