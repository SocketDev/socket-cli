import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { failMsgWithBadge } from '../../util/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../util/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
const logger = getDefaultLogger()

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
