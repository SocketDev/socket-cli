import path from 'node:path'

import { logger } from '@socketsecurity/lib/logger'

import { DOT_SOCKET_DOT_FACTS_JSON } from '../../constants/paths.mts'
import type { CResult, OutputKind } from '../../types.mts'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'
import type { ReachabilityAnalysisResult } from './perform-reachability-analysis.mts'

export async function outputScanReach(
  result: CResult<ReachabilityAnalysisResult>,
  { cwd, outputKind }: { cwd: string; outputKind: OutputKind },
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  logger.log('')
  logger.success('Reachability analysis completed successfully!')
  logger.info(
    `Reachability report has been written to: ${path.join(cwd, DOT_SOCKET_DOT_FACTS_JSON)}`,
  )
}
