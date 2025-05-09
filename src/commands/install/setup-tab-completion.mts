import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { debugLog } from '@socketsecurity/registry/lib/debug'

import constants from '../../constants.mts'
import { getBashrcDetails } from '../../utils/completion.mts'

import type { CResult } from '../../types.mts'

export async function setupTabCompletion(targetName: string): Promise<
  CResult<{
    actions: string[]
    bashrcPath: string
    bashrcUpdated: boolean
    completionCommand: string
    foundBashrc: boolean
    sourcingCommand: string
    targetName: string
  }>
> {
  const result = getBashrcDetails(targetName)
  if (!result.ok) {
    return result
  }

  const { completionCommand, sourcingCommand, targetPath, toAddToBashrc } =
    result.data

  // Target dir is something like ~/.local/share/socket/settings/completion (linux)
  const targetDir = path.dirname(targetPath)
  debugLog('Target Path:', targetPath, ', Target Dir:', targetDir)
  if (!fs.existsSync(targetDir)) {
    debugLog('Dir does not exist, creating it now...')
    fs.mkdirSync(targetDir, { recursive: true })
  }

  // Lazily access constants.ENV.INLINED_SOCKET_CLI_VERSION_HASH.
  const CLI_VERSION = constants.ENV.INLINED_SOCKET_CLI_VERSION_HASH

  // Copy the completion script to the config directory
  const sourcePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'socket-completion.bash'
  )
  const content = fs.readFileSync(sourcePath, 'utf8')
  // When installing set the current package.json version.
  // Later, we can call _socket_completion_version to get the installed version.
  fs.writeFileSync(
    targetPath,
    content.replaceAll('SOCKET_VERSION_TOKEN', CLI_VERSION),
    'utf8'
  )

  let bashrcUpdated = false

  // Add to ~/.bashrc if not already there
  const bashrcPath = process.env['HOME']
    ? path.join(process.env['HOME'], '.bashrc')
    : ''

  const foundBashrc = Boolean(bashrcPath && fs.existsSync(bashrcPath))

  if (foundBashrc) {
    const content = fs.readFileSync(bashrcPath, 'utf8')
    if (!content.includes(sourcingCommand)) {
      fs.appendFileSync(bashrcPath, toAddToBashrc)
      bashrcUpdated = true
    }
  }

  return {
    ok: true,
    data: {
      actions: [
        `Installed the tab completion script in ${targetPath}`,
        bashrcUpdated
          ? 'Added tab completion loader to ~/.bashrc'
          : foundBashrc
            ? 'Tab completion already found in ~/.bashrc'
            : 'No ~/.bashrc found'
      ],
      bashrcPath,
      bashrcUpdated,
      completionCommand,
      foundBashrc,
      sourcingCommand,
      targetName
    }
  }
}
