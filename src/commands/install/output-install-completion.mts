import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'

import type { CResult } from '../../types.mts'

export async function outputInstallCompletion(
  result: CResult<{
    actions: string[]
    bashrcPath: string
    completionCommand: string
    bashrcUpdated: boolean
    foundBashrc: boolean
    sourcingCommand: string
    targetName: string
  }>
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1

    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  logger.log('')
  logger.log(
    `Installation of tab completion for "${result.data.targetName}" finished!`
  )
  logger.log('')

  result.data.actions.forEach(action => {
    logger.log(`  - ${action}`)
  })
  logger.log('')
  logger.log('Socket tab completion work automatically in new terminals.')
  logger.log('')
  logger.log(
    'Due to a bash limitation, tab completion cannot be enabled in the'
  )
  logger.log('current shell (bash instance) through NodeJS. You must either:')
  logger.log('')
  logger.log('1. Reload your .bashrc script (best):')
  logger.log('')
  logger.log(`   source ~/.bashrc`)
  logger.log('')
  logger.log('2. Run these commands to load the completion script:')
  logger.log('')
  logger.log(`   ${result.data.sourcingCommand}`)
  logger.log(`   ${result.data.completionCommand}`)
  logger.log('')
  logger.log('3. Or restart bash somehow (restart terminal or run `bash`)')
  logger.log('')
}
