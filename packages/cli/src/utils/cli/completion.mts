import fs from 'node:fs'
import path from 'node:path'

import { getSocketAppDataPath, rootPath } from '../../constants/paths.mts'

import type { CResult } from '../../types.mjs'

export const COMPLETION_CMD_PREFIX = 'complete -F _socket_completion'

export function getCompletionSourcingCommand(): CResult<string> {
  // Bash completion script lives in data directory.
  const completionScriptPath = path.join(
    rootPath,
    'data',
    'socket-completion.bash',
  )

  if (!fs.existsSync(completionScriptPath)) {
    return {
      ok: false,
      message: 'Tab Completion script not found',
      cause: `Expected to find completion script at \`${completionScriptPath.replace(/\\/g, '/')}\` but it was not there`,
    }
  }

  // Bash scripts always use forward slashes, even on Windows.
  return {
    ok: true,
    data: `source ${completionScriptPath.replace(/\\/g, '/')}`,
  }
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

  const socketAppDataPath = getSocketAppDataPath()
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

  // Bash scripts always use forward slashes, even on Windows.
  const bashCompletionPath = completionScriptPath.replace(/\\/g, '/')

  const bashrcContent = `# Socket CLI completion for "${targetCommandName}"
if [ -f "${bashCompletionPath}" ]; then
    # Load the tab completion script
    source "${bashCompletionPath}"
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
      targetPath: bashCompletionPath,
    },
  }
}
