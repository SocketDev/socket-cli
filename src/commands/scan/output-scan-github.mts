/** @fileoverview GitHub scan output formatter for Socket CLI. Displays GitHub repository scan results in JSON or text formats. Shows scan creation status and error messages. */

import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'

export async function outputScanGithub(
  result: CResult<unknown>,
  outputKind: OutputKind,
) {
  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    return
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  logger.log('')
  logger.success('Finished!')
}
