import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getConfigPath } from './config.mts'

import type { CResult } from '../types.mts'

export function getCompletionSourcingCommand(): CResult<string> {
  // Get the path to the completion script relative to the current module
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const completionScript = path.join(
    __dirname,
    '..',
    'commands',
    'install',
    'socket-completion.bash'
  )

  if (!fs.existsSync(completionScript)) {
    return {
      ok: false,
      message: 'Tab Completion script not found',
      cause: `Expected to find completion script at \`${completionScript}\` but it was not there`
    }
  }

  return { ok: true, data: `source ${completionScript}` }
}

export function getBashrcDetails(targetName: string): CResult<{
  completionCommand: string
  sourcingCommand: string
  toAddToBashrc: string
  targetName: string
  targetPath: string
}> {
  const sourcingCommand = getCompletionSourcingCommand()
  if (!sourcingCommand.ok) {
    return sourcingCommand
  }

  const configFilePath = getConfigPath()
  if (!configFilePath) {
    return {
      ok: false,
      message: 'Could not determine config directory',
      cause: 'Failed to get config path'
    }
  }

  const completionCommand = `complete -F _socket_completion ${targetName}`

  const completionScriptPath = path.join(
    path.dirname(configFilePath),
    'completion',
    'socket-completion.bash'
  )
  const bashrcContent = `# Socket CLI completion for "${targetName}"
if [ -f "${completionScriptPath}" ]; then
    # Get the tab completion script
    source "${completionScriptPath}"
    # Tell bash to use this function for tab completion of this function
    ${completionCommand}
fi
`

  return {
    ok: true,
    data: {
      sourcingCommand: sourcingCommand.data,
      completionCommand,
      toAddToBashrc: bashrcContent,
      targetName,
      targetPath: completionScriptPath
    }
  }
}
