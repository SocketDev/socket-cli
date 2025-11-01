import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { DOT_SOCKET_DOT_FACTS_JSON } from '../../constants/paths.mts'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { ReachabilityAnalysisResult } from './perform-reachability-analysis.mts'
import type { CResult, OutputKind } from '../../types.mts'

export async function outputScanReach(
  result: CResult<ReachabilityAnalysisResult>,
  {
    outputKind,
    outputPath,
  }: { cwd: string; outputKind: OutputKind; outputPath: string },
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

  const actualOutputPath = outputPath?.trim()
    ? outputPath
    : DOT_SOCKET_DOT_FACTS_JSON

  getDefaultLogger().log('')
  getDefaultLogger().success('Reachability analysis completed successfully!')
  getDefaultLogger().info(
    `Reachability report has been written to: ${actualOutputPath}`,
  )
}
