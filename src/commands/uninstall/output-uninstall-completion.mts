import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'

import type { CResult } from '../../types.mts'

export async function outputUninstallCompletion(
  result: CResult<{ action: string }>,
  targetName: string
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1

    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  logger.log(result.message)
  logger.log('')
  logger.log(
    'To remove the tab completion from the current shell (instance of bash) you'
  )
  logger.log(
    'can run this command (due to a bash limitation NodeJS cannot do this):'
  )
  logger.log('')
  logger.log(`    complete -r ${targetName}`)
  logger.log('')
  logger.log(
    'Next time you open a terminal it should no longer be there, regardless.'
  )
}
