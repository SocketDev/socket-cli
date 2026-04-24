import isInteractive from '@socketregistry/is-interactive/index.cjs'

import { attemptLogin } from './attempt-login.mts'
import { outputDryRunWrite } from '../../utils/dry-run/output.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { InputError } from '../../utils/error/errors.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output/formatting.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

// Flags interface for type safety.
interface LoginFlags {
  apiBaseUrl?: string | undefined
  apiProxy?: string | undefined
}

export const CMD_NAME = 'login'

const description = 'Setup Socket CLI with an API token and defaults'

const hidden = false

export const cmdLogin = {
  description,
  hidden,
  run,
}

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
      apiBaseUrl: {
        type: 'string',
        default: '',
        description: 'API server to connect to for login',
      },
      apiProxy: {
        type: 'string',
        default: '',
        description: 'Proxy to use when making connection to API server',
      },
    },
    help: (command, config) => `
    Usage
      $ ${command} [options]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Logs into the Socket API by prompting for an API token

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} --api-proxy=http://localhost:1234
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    parentName,
    importMeta,
  })

  const dryRun = !!cli.flags['dryRun']

  if (dryRun) {
    const configPath = `${process.env['HOME']}/.config/socket/config.json`
    const changes = [
      'Prompt for Socket API token',
      'Verify token with Socket API',
      'Save API token to config',
      'Optionally set default organization',
      'Optionally install bash completion',
    ]
    outputDryRunWrite(configPath, 'authenticate with Socket API', changes)
    return
  }

  if (!isInteractive()) {
    throw new InputError(
      'socket login needs an interactive TTY to prompt for credentials (stdin/stdout is not a TTY); set SOCKET_CLI_API_TOKEN in the environment instead',
    )
  }

  const { apiBaseUrl, apiProxy } = cli.flags as unknown as LoginFlags

  await attemptLogin(apiBaseUrl, apiProxy)
}
