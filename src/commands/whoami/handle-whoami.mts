/** @fileoverview Whoami handler for Socket CLI. Orchestrates authentication status check by fetching user data and delegating to output formatter. */

import { logger } from '@socketsecurity/registry/lib/logger'

import { outputWhoami } from './output-whoami.mts'
import constants, {
  CONFIG_KEY_API_TOKEN,
  TOKEN_PREFIX,
} from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { getConfigValueOrUndef } from '../../utils/config.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { getDefaultApiToken, getVisibleTokenPrefix } from '../../utils/sdk.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

export async function handleWhoami(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config: CliCommandConfig = {
    commandName: 'whoami',
    description: 'Check Socket CLI authentication status',
    hidden: false,
    flags: {
      ...commonFlags,
    },
    help: (command, config) => `
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
    parentName,
    importMeta,
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
        token: tokenDisplay,
        location: tokenLocation,
      })
    } else {
      logger.success(`Authenticated with Socket`)
      logger.log(`  Token: ${tokenDisplay}`)
      logger.log(`  Source: ${tokenLocation}`)
    }
  } else {
    if (flags['json']) {
      outputWhoami({
        authenticated: false,
        token: null,
        location: null,
      })
    } else {
      logger.fail(`Not authenticated with Socket`)
      logger.log(``)
      logger.log(`To authenticate, run one of:`)
      logger.log(`  socket login`)
      logger.log(`  export SOCKET_SECURITY_API_KEY=<your-token>`)
    }
  }
}

function getTokenLocation(): string {
  // Check environment variable first.
  if (constants.ENV['SOCKET_CLI_API_TOKEN']) {
    return 'Environment variable (SOCKET_SECURITY_API_KEY)'
  }

  // Check config file.
  const configToken = getConfigValueOrUndef(CONFIG_KEY_API_TOKEN)
  if (configToken) {
    return 'Config file (~/.config/socket/config.toml)'
  }

  return 'Unknown'
}
