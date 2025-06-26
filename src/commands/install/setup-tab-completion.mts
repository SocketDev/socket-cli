import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { debugFn } from '@socketsecurity/registry/lib/debug'

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
    targetPath: string
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
  debugFn('target: path + dir', targetPath, targetDir)

  if (!fs.existsSync(targetDir)) {
    debugFn('create: target dir')
    fs.mkdirSync(targetDir, { recursive: true })
  }

  updateInstalledTabCompletionScript(targetPath)

  let bashrcUpdated = false

  // Add to ~/.bashrc if not already there
  // Lazily access constants.homePath
  const bashrcPath = constants.homePath
    ? path.join(constants.homePath, '.bashrc')
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
            : 'No ~/.bashrc found so tab completion was not completely installed',
      ],
      bashrcPath,
      bashrcUpdated,
      completionCommand,
      foundBashrc,
      sourcingCommand,
      targetName,
      targetPath,
    },
  }
}

function getTabCompletionScriptRaw(): CResult<string> {
  const sourceDir = path.dirname(fileURLToPath(import.meta.url))
  const sourcePath = path.join(sourceDir, 'socket-completion.bash')

  if (!fs.existsSync(sourcePath)) {
    return {
      ok: false,
      message: 'Source not found.',
      cause: `Unable to find the source tab completion bash script that Socket should ship. Expected to find it in \`${sourcePath}\` but it was not there.`,
    }
  }

  return { ok: true, data: fs.readFileSync(sourcePath, 'utf8') }
}

export function updateInstalledTabCompletionScript(
  targetPath: string,
): CResult<undefined> {
  const content = getTabCompletionScriptRaw()
  if (!content.ok) {
    return content
  }

  // When installing set the current package.json version.
  // Later, we can call _socket_completion_version to get the installed version.
  fs.writeFileSync(
    targetPath,
    content.data.replaceAll(
      '%SOCKET_VERSION_TOKEN%',
      // Lazily access constants.ENV.INLINED_SOCKET_CLI_VERSION_HASH.
      constants.ENV.INLINED_SOCKET_CLI_VERSION_HASH),
    'utf8',
  )

  return { ok: true, data: undefined }
}
