import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { CONFIG_KEY_API_TOKEN } from '../../constants/config.mjs'
import ENV from '../../constants/env.mts'
import { TOKEN_PREFIX } from '../../constants/socket.mjs'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { getConfigValueOrUndef } from '../../utils/config.mts'
import { getFlagListOutput } from '../../utils/output/formatting.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'
import {
  getDefaultApiToken,
  getVisibleTokenPrefix,
} from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

const logger = getDefaultLogger()

export const CMD_NAME = 'whoami'

const description = 'Check Socket CLI authentication status'

const hidden = false

// Types.

interface WhoamiStatus {
  authenticated: boolean
  location: string | null
  token: string | null
}

// Helper functions.

function getTokenLocation(): string {
  // Check environment variable first.
  if (ENV.SOCKET_CLI_API_TOKEN) {
    return 'Environment variable (SOCKET_SECURITY_API_KEY)'
  }

  // Check config file.
  const configToken = getConfigValueOrUndef(CONFIG_KEY_API_TOKEN)
  if (configToken) {
    return 'Config file (~/.config/socket/config.toml)'
  }

  return 'Unknown'
}

function outputWhoami(status: WhoamiStatus): void {
  const result: CResult<WhoamiStatus> = {
    ok: true,
    data: status,
  }
  logger.log(serializeResultJson(result))
}

// Command handler.

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config: CliCommandConfig = {
    commandName: CMD_NAME,
    description,
    hidden,
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
        location: null,
        token: null,
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
