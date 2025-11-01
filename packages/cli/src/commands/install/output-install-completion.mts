import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'

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
    targetPath: string
  }>,
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1

    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  getDefaultLogger().log('')
  getDefaultLogger().log(
    `Installation of tab completion for "${result.data.targetName}" finished!`,
  )
  getDefaultLogger().log('')

  result.data.actions.forEach(action => {
    getDefaultLogger().log(`  - ${action}`)
  })
  getDefaultLogger().log('')
  getDefaultLogger().log(
    'Socket tab completion works automatically in new terminals.',
  )
  getDefaultLogger().log('')
  getDefaultLogger().log(
    'Due to a bash limitation, tab completion cannot be enabled in the',
  )
  getDefaultLogger().log(
    'current shell (bash instance) through NodeJS. You must either:',
  )
  getDefaultLogger().log('')
  getDefaultLogger().log('1. Reload your .bashrc script (best):')
  getDefaultLogger().log('')
  getDefaultLogger().log('   source ~/.bashrc')
  getDefaultLogger().log('')
  getDefaultLogger().log('2. Run these commands to load the completion script:')
  getDefaultLogger().log('')
  getDefaultLogger().log(`   source ${result.data.targetPath}`)
  getDefaultLogger().log(`   ${result.data.completionCommand}`)
  getDefaultLogger().log('')
  getDefaultLogger().log(
    '3. Or restart bash somehow (restart terminal or run `bash`)',
  )
  getDefaultLogger().log('')
}
