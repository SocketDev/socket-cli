import { logger } from '@socketsecurity/registry/lib/logger'
import { pluralize } from '@socketsecurity/registry/lib/words'

import constants from '../../constants.mts'
import { extractReachabilityErrors } from '../../utils/coana.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { ReachabilityAnalysisResult } from './perform-reachability-analysis.mts'
import type { CResult, OutputKind } from '../../types.mts'

export async function outputScanReach(
  result: CResult<ReachabilityAnalysisResult>,
  { outputKind, outputPath }: { outputKind: OutputKind; outputPath: string },
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

  // Warn about individual vulnerabilities where reachability analysis errored.
  const errors = extractReachabilityErrors(
    result.data.reachabilityReport,
  )
  if (errors.length) {
    logger.log('')
    logger.warn(
      `Reachability analysis returned ${errors.length} ${pluralize('error', errors.length)} for individual ${pluralize('vulnerability', errors.length)}:`,
    )
    for (const err of errors) {
      logger.warn(
        `  - ${err.ghsaId} in ${err.componentName}@${err.componentVersion} (${err.subprojectPath})`,
      )
    }
  }
}
