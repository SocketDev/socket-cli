import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { ReachabilityAnalysisResult } from './perform-reachability-analysis.mts'
import type { CResult, OutputKind } from '../../types.mts'

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
    `Reachability report has been written to: ${path.join(cwd, constants.DOT_SOCKET_DOT_FACTS_JSON)}`,
  )
}
