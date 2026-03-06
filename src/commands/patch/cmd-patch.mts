import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

import constants from '../../constants.mts'

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

async function run(
  argv: string[] | readonly string[],
  _importMeta: ImportMeta,
  _context: CliCommandContext,
): Promise<void> {
  const { ENV } = constants

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
  const binPath = resolveSocketPatchBin()
  const result = spawnSync(binPath, [...argv], {
    stdio: 'inherit',
    env: spawnEnv,
  })

  if (result.error) {
    throw result.error
  }
  if (result.signal) {
    process.kill(process.pid, result.signal)
  }
  if (result.status !== null && result.status !== 0) {
    process.exitCode = result.status
  }
}
