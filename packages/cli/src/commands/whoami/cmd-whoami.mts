import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { CONFIG_KEY_API_TOKEN } from '../../constants/config.mjs'
import { SOCKET_CLI_API_TOKEN } from '../../env/socket-cli-api-token.mts'
import { TOKEN_PREFIX } from '../../constants/socket.mjs'
import { defineFlags } from '../../meow.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import { getConfigValueOrUndef } from '../../util/config.mts'
import { getFlagListOutput } from '../../util/output/formatting.mts'
import { serializeResultJson } from '../../util/output/result-json.mjs'
import {
  getDefaultApiToken,
  getVisibleTokenPrefix,
} from '../../util/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'

const logger = getDefaultLogger()

export const CMD_NAME = 'whoami'

const description = 'Check Socket CLI authentication status'

const hidden = false

// Types.

interface WhoamiStatus {
  authenticated: boolean
  location: string | undefined
  token: string | undefined
}

// Helper functions.

export function getTokenLocation(): string {
  // Check environment variable first.
  if (SOCKET_CLI_API_TOKEN) {
    return 'Environment variable (SOCKET_SECURITY_API_KEY)'
  }

  // Check config file.
  const configToken = getConfigValueOrUndef(CONFIG_KEY_API_TOKEN)
  if (configToken) {
    return 'Config file (~/.config/socket/config.toml)'
  }

  return 'Unknown'
}

export function outputWhoami(status: WhoamiStatus): void {
  const result: CResult<WhoamiStatus> = {
    ok: true,
    data: status,
  }
  logger.log(serializeResultJson(result))
}

export async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: defineFlags({
      ...commonFlags,
    }),
    help: (command: string, config: { flags: MeowFlags }) => `
    Usage
      $ ${command}

    Check if you are authenticated with Socket

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} --json
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const flags = cli.flags

  const apiToken = getDefaultApiToken()
  const tokenLocation = getTokenLocation()

  if (apiToken) {
    const visiblePrefix = getVisibleTokenPrefix()
    const tokenDisplay = `${TOKEN_PREFIX}${visiblePrefix}...`

    if (flags['json']) {
      outputWhoami({
        authenticated: true,
        location: tokenLocation,
        token: tokenDisplay,
      })
    } else {
      logger.success('Authenticated with Socket')
      logger.log(`  Token: ${tokenDisplay}`)
      logger.log(`  Source: ${tokenLocation}`)
    }
  } else {
    if (flags['json']) {
      outputWhoami({
        authenticated: false,
        location: undefined,
        token: undefined,
      })
    } else {
      logger.fail('Not authenticated with Socket')
      logger.log('')
      logger.log('To authenticate, run one of:')
      logger.log('  socket login')
      logger.log('  export SOCKET_SECURITY_API_KEY=<your-token>')
    }
  }
}

// Exported command.

export const cmdWhoami = {
  description,
  hidden,
  run,
}
