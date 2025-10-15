import fs from 'node:fs'
import path from 'node:path'

import constants from '../../constants.mjs'

import type { CResult } from '../../types.mjs'

export const COMPLETION_CMD_PREFIX = 'complete -F _socket_completion'

export function getCompletionSourcingCommand(): CResult<string> {
  // Bash completion script lives in data directory.
  const completionScriptPath = path.join(
    constants.rootPath,
    'data',
    'socket-completion.bash',
  )

  if (!fs.existsSync(completionScriptPath)) {
    return {
      ok: false,
      message: 'Tab Completion script not found',
      cause: `Expected to find completion script at \`${completionScriptPath}\` but it was not there`,
    }
  }

  return { ok: true, data: `source ${completionScriptPath}` }
}

export function getBashrcDetails(targetCommandName: string): CResult<{
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

  const { socketAppDataPath } = constants
  if (!socketAppDataPath) {
    return {
      ok: false,
      message: 'Could not determine config directory',
      cause: 'Failed to get config path',
    }
  }

  // _socket_completion is the function defined in our completion bash script
  const completionCommand = `${COMPLETION_CMD_PREFIX} ${targetCommandName}`

  // Location of completion script in config after installing
  const completionScriptPath = path.join(
    path.dirname(socketAppDataPath),
    'completion',
    'socket-completion.bash',
  )

  const bashrcContent = `# Socket CLI completion for "${targetCommandName}"
if [ -f "${completionScriptPath}" ]; then
    # Load the tab completion script
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
      targetName: targetCommandName,
      targetPath: completionScriptPath,
    },
  }
}
