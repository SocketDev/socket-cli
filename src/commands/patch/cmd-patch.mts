import { spawnSync } from 'node:child_process'
import {
  accessSync,
  existsSync,
  constants as fsConstants,
  statSync,
} from 'node:fs'
import path from 'node:path'

import constants from '../../constants.mts'
import {
  cleanupBundledTool,
  getBundledTool,
  isStandaloneSea,
} from '../../sea/runtime.mts'

import type { CliCommandContext } from '../../utils/meow-with-subcommands.mts'

export const CMD_NAME = 'patch'

const description =
  'Apply, manage, and rollback Socket security patches for vulnerable dependencies'

const hidden = false

export const cmdPatch = {
  description,
  hidden,
  run,
}

// Resolve the path to the socket-patch binary.
// The @socketsecurity/socket-patch package registers a bin entry that pnpm
// links into node_modules/.bin/socket-patch. This launcher script finds and
// executes the platform-specific Rust binary from the optionalDependencies.
function resolveSocketPatchBin(): string {
  // Walk up from this file (or dist/) to find the closest node_modules/.bin.
  let dir = __dirname
  for (let i = 0; i < 10; i += 1) {
    const candidate = path.join(dir, 'node_modules', '.bin', 'socket-patch')
    if (existsSync(candidate)) {
      return candidate
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  // Fallback: assume socket-patch is on PATH.
  return 'socket-patch'
}

function isSelfUpdate(argv: readonly string[]): boolean {
  return argv.some(
    (arg, index) =>
      arg === '--update' ||
      arg === 'self-update' ||
      arg === 'selfupdate' ||
      arg === 'self_update' ||
      ((arg === 'update' || arg === 'upgrade') &&
        (index === 0 || argv[index - 1] === 'socket-patch')),
  )
}

function validateExplicitSocketPatchPath(binPath: string): string {
  const absoluteBinPath = path.resolve(binPath)
  try {
    const stats = statSync(absoluteBinPath)
    if (!stats.isFile()) {
      throw new Error('not a regular file')
    }
    accessSync(absoluteBinPath, fsConstants.X_OK)
  } catch (cause) {
    throw new Error(
      `SOCKET_CLI_SOCKET_PATCH_PATH must name an existing executable file: ${absoluteBinPath}`,
      { cause },
    )
  }
  return absoluteBinPath
}

async function run(
  argv: string[] | readonly string[],
  _importMeta: ImportMeta,
  _context: CliCommandContext,
): Promise<void> {
  const { ENV } = constants

  const standalone = isStandaloneSea()
  if (standalone && isSelfUpdate(argv)) {
    throw new Error(
      'socket-patch self-update is unavailable in the standalone Socket build because it cannot replace the bundled executable.',
    )
  }
  let explicitBinPath = standalone
    ? ENV.SOCKET_CLI_SOCKET_PATCH_PATH
    : undefined
  let bundledBinPath: string | undefined
  if (standalone) {
    // The explicit override takes precedence; otherwise extract only the
    // verified embedded payload. Neither branch consults PATH.
    if (explicitBinPath) {
      explicitBinPath = validateExplicitSocketPatchPath(explicitBinPath)
    } else {
      bundledBinPath = await getBundledTool('socket-patch')
      explicitBinPath = bundledBinPath
    }
  }

  // Build environment variables for the socket-patch binary.
  const spawnEnv: Record<string, string | undefined> = {
    ...process.env,
  }

  // Map socket-cli environment to socket-patch environment variables.
  // Strip /v0/ suffix from API URL if present.
  const apiUrl = ENV.SOCKET_CLI_API_BASE_URL?.replace(/\/v0\/?$/, '')
  if (apiUrl) {
    spawnEnv['SOCKET_API_URL'] = apiUrl
  }
  if (ENV.SOCKET_CLI_API_TOKEN) {
    spawnEnv['SOCKET_API_TOKEN'] = ENV.SOCKET_CLI_API_TOKEN
  }
  if (ENV.SOCKET_CLI_ORG_SLUG) {
    spawnEnv['SOCKET_ORG_SLUG'] = ENV.SOCKET_CLI_ORG_SLUG
  }
  if (ENV.SOCKET_PATCH_PROXY_URL) {
    spawnEnv['SOCKET_PATCH_PROXY_URL'] = ENV.SOCKET_PATCH_PROXY_URL
  }
  if (ENV.SOCKET_CLI_API_PROXY) {
    spawnEnv['HTTPS_PROXY'] = ENV.SOCKET_CLI_API_PROXY
  }
  if (ENV.SOCKET_CLI_DEBUG) {
    spawnEnv['SOCKET_PATCH_DEBUG'] = '1'
  }

  // Resolve and spawn the socket-patch Rust binary.
  // On Windows, node_modules/.bin shims are .cmd scripts that require shell.
  const binPath = explicitBinPath || resolveSocketPatchBin()
  try {
    const result = spawnSync(binPath, [...argv], {
      stdio: 'inherit',
      env: spawnEnv,
      shell: explicitBinPath ? false : constants.WIN32,
    })

    if (result.error) {
      throw result.error
    }
    // Propagate signal if the child was killed (e.g. SIGTERM, SIGINT).
    if (result.signal) {
      if (bundledBinPath) {
        await cleanupBundledTool(bundledBinPath)
        bundledBinPath = undefined
      }
      process.kill(process.pid, result.signal)
      return
    }
    if (result.status !== null && result.status !== 0) {
      process.exitCode = result.status
    }
  } finally {
    if (bundledBinPath) {
      await cleanupBundledTool(bundledBinPath)
    }
  }
}
