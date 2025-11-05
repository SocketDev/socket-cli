import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { debug } from '@socketsecurity/lib/debug'
import { safeMkdirSync } from '@socketsecurity/lib/fs'

import ENV from '../../constants/env.mts'
import { homePath } from '../../constants/paths.mts'
import { getBashrcDetails } from '../../utils/cli/completion.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

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
  debug(`target: path + dir ${targetPath} ${targetDir}`)

  if (!fs.existsSync(targetDir)) {
    debug('create: target dir')
    safeMkdirSync(targetDir, { recursive: true })
  }

  updateInstalledTabCompletionScript(targetPath)

  let bashrcUpdated = false

  // Add to ~/.bashrc if not already there
  const bashrcPath = homePath ? path.join(homePath, '.bashrc') : ''

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
  // Resolve the @socketsecurity/cli package root to find the data directory.
  // This works whether running from source, installed globally, or via npx/dlx.
  let sourcePath: string
  try {
    const cliPackageJson = require.resolve('@socketsecurity/cli/package.json')
    const cliPackageRoot = path.dirname(cliPackageJson)
    sourcePath = path.join(cliPackageRoot, 'data', 'socket-completion.bash')
  } catch {
    // Fallback for development: look relative to this file.
    sourcePath = path.resolve(__dirname, '../../../data/socket-completion.bash')
  }

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
      ENV.INLINED_SOCKET_CLI_VERSION_HASH || '',
    ),
    'utf8',
  )

  return { ok: true, data: undefined }
}
