import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'

import type { CResult } from '../../types.mts'

export async function outputUninstallCompletion(
  result: CResult<{ action: string; left: string[] }>,
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
  logger.log('')
  if (result.data.left.length) {
    logger.log(
      'Detected more Socket Alias completions left in bashrc. Run `socket uninstall <cmd>` to remove them too.'
    )
    logger.log('')
    result.data.left.forEach(str => {
      logger.log(`  - \`${str}\``)
    })
    logger.log('')
  }
}
