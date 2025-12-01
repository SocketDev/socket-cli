import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { ReachabilityAnalysisResult } from './perform-reachability-analysis.mts'
import type { CResult, OutputKind } from '../../types.mts'

export async function outputScanReach(
  result: CResult<ReachabilityAnalysisResult>,
  {
    outputKind,
    outputPath,
  }: { outputKind: OutputKind; outputPath: string },
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

  const actualOutputPath = outputPath || constants.DOT_SOCKET_DOT_FACTS_JSON

  logger.log('')
  logger.success('Reachability analysis completed successfully!')
  logger.info(`Reachability report has been written to: ${actualOutputPath}`)
}
