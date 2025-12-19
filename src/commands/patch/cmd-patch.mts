import constants from '../../constants.mts'
import { runPatch } from '@socketsecurity/socket-patch/run'

import type { CliCommandContext } from '../../utils/meow-with-subcommands.mts'

export const CMD_NAME = 'patch'

const description = 'Manage CVE patches for dependencies'

const hidden = false

export const cmdPatch = {
  description,
  hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  _importMeta: ImportMeta,
  _context: CliCommandContext,
): Promise<void> {
  const { ENV } = constants

  // Map socket-cli environment to socket-patch options.
  // Only include properties with defined values (exactOptionalPropertyTypes).
  const options: Parameters<typeof runPatch>[1] = {}

  // Strip /v0/ suffix from API URL if present.
  const apiUrl = ENV.SOCKET_CLI_API_BASE_URL?.replace(/\/v0\/?$/, '')
  if (apiUrl) {
    options.apiUrl = apiUrl
  }
  if (ENV.SOCKET_CLI_API_TOKEN) {
    options.apiToken = ENV.SOCKET_CLI_API_TOKEN
  }
  if (ENV.SOCKET_CLI_ORG_SLUG) {
    options.orgSlug = ENV.SOCKET_CLI_ORG_SLUG
  }
  if (ENV.SOCKET_PATCH_PROXY_URL) {
    options.patchProxyUrl = ENV.SOCKET_PATCH_PROXY_URL
  }
  if (ENV.SOCKET_CLI_API_PROXY) {
    options.httpProxy = ENV.SOCKET_CLI_API_PROXY
  }
  if (ENV.SOCKET_CLI_DEBUG) {
    options.debug = ENV.SOCKET_CLI_DEBUG
  }

  // Forward all arguments to socket-patch.
  const exitCode = await runPatch([...argv], options)

  if (exitCode !== 0) {
    process.exitCode = exitCode
  }
}
