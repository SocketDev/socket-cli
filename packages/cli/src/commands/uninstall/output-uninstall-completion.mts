import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'

import type { CResult } from '../../types.mts'

export async function outputUninstallCompletion(
  result: CResult<{ action: string; left: string[] }>,
  targetName: string,
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1

    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  getDefaultLogger().log(result.message)
  getDefaultLogger().log('')
  getDefaultLogger().log(
    'To remove the tab completion from the current shell (instance of bash) you',
  )
  getDefaultLogger().log(
    'can run this command (due to a bash limitation NodeJS cannot do this):',
  )
  getDefaultLogger().log('')
  getDefaultLogger().log(`    complete -r ${targetName}`)
  getDefaultLogger().log('')
  getDefaultLogger().log(
    'Next time you open a terminal it should no longer be there, regardless.',
  )
  getDefaultLogger().log('')
  if (result.data.left.length) {
    getDefaultLogger().log(
      'Detected more Socket Alias completions left in bashrc. Run `socket uninstall <cmd>` to remove them too.',
    )
    getDefaultLogger().log('')
    result.data.left.forEach(str => {
      getDefaultLogger().log(`  - \`${str}\``)
    })
    getDefaultLogger().log('')
  }
}
