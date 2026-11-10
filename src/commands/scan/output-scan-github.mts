import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { logger } from '../../utils/logger.mts'
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
