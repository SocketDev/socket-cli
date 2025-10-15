import { logger } from '@socketsecurity/registry/lib/logger'

import { OUTPUT_JSON } from '../../constants.mts'
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

  if (outputKind === OUTPUT_JSON) {
    logger.log(serializeResultJson(result))
    return
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const { files, outputDir, purl } = result.data

  if (outputKind === 'json') {
    logger.log(JSON.stringify({ files, outputDir, purl }, null, 2))
    return
  }

  if (outputKind === 'markdown') {
    logger.log('## Patch Files Retrieved\n')
    logger.log(`**PURL**: ${purl}`)
    logger.log(`**Output Directory**: ${outputDir}`)
    logger.log(`**Files**: ${files.length}\n`)
    for (const file of files) {
      logger.log(`- ${file}`)
    }
    return
  }

  // Default output.
  logger.group('')
  logger.log(`PURL: ${purl}`)
  logger.log(`Output directory: ${outputDir}`)
  logger.log(`Files copied: ${files.length}`)
  if (files.length > 0) {
    logger.group()
    for (const file of files) {
      logger.log(`- ${file}`)
    }
    logger.groupEnd()
  }
  logger.groupEnd()
}
