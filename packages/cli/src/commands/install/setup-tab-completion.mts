import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { debug } from '@socketsecurity/lib-stable/debug'
import { safeMkdirSync } from '@socketsecurity/lib-stable/fs'

import { getCliVersionHash } from '../../env/cli-version-hash.mts'
import { homePath } from '../../constants/paths.mts'
import { getBashrcDetails } from '../../util/cli/completion.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

import type { CResult } from '../../types.mts'

export function getTabCompletionScriptRaw(): CResult<string> {
  // Resolve the @socketsecurity/cli package root to find the data directory.
  // This works whether running from source, installed globally, or via npx/dlx.
  let sourcePath: string
  try {
    const cliPackageJson = require.resolve('@socketsecurity/cli/package.json')
    const cliPackageRoot = path.dirname(cliPackageJson)
    sourcePath = path.join(cliPackageRoot, 'data', 'socket-completion.bash')
    /* c8 ignore start - fallback for source-tree development; require.resolve always succeeds in tests because the workspace package is installed */
  } catch {
    sourcePath = path.resolve(__dirname, '../../../data/socket-completion.bash')
  }
  /* c8 ignore stop */

  if (!existsSync(sourcePath)) {
    return {
      ok: false,
      message: 'Source not found.',
      cause: `Unable to find the source tab completion bash script that Socket should ship. Expected to find it in \`${sourcePath}\` but it was not there.`,
    }
  }

  return { ok: true, data: readFileSync(sourcePath, 'utf8') }
}

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

  if (!existsSync(targetDir)) {
    debug('create: target dir')
    safeMkdirSync(targetDir, { recursive: true })
  }

  updateInstalledTabCompletionScript(targetPath)

  let bashrcUpdated = false

  // Add to ~/.bashrc if not already there
  const bashrcPath = homePath ? path.join(homePath, '.bashrc') : ''

  const foundBashrc = Boolean(bashrcPath && existsSync(bashrcPath))

  if (foundBashrc) {
    try {
      const content = readFileSync(bashrcPath, 'utf8')
      if (!content.includes(sourcingCommand)) {
        appendFileSync(bashrcPath, toAddToBashrc)
        bashrcUpdated = true
      }
    } catch {
      // File may have been deleted or become unreadable between check and read.
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

export function updateInstalledTabCompletionScript(
  targetPath: string,
): CResult<undefined> {
  const content = getTabCompletionScriptRaw()
  if (!content.ok) {
    return content
  }

  // When installing set the current package.json version.
  // Later, we can call _socket_completion_version to get the installed version.
  writeFileSync(
    targetPath,
    content.data.replaceAll('%SOCKET_VERSION_TOKEN%', getCliVersionHash()),
    'utf8',
  )

  return { ok: true, data: undefined }
}
