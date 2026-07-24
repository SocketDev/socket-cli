import isInteractive from '@socketregistry/is-interactive/index.cjs'

import { attemptLogin } from './attempt-login.mts'
import { outputDryRunWrite } from '../../util/dry-run/output.mts'
import { defineFlags } from '../../meow.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import { InputError } from '../../util/error/errors.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../util/output/formatting.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'

// Flags interface for type safety.
export interface LoginFlags {
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
    }),
    help: (command: string, helpConfig: { flags: MeowFlags }) => `
    Usage
      $ ${command} [options]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Logs into the Socket API by prompting for an API token

    Options
      ${getFlagListOutput(helpConfig.flags)}

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

  const dryRun = cli.flags['dryRun']

  if (dryRun) {
    // Runtime read so tests that mutate process.env['HOME'] pick up changes.
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

  const { apiBaseUrl, apiProxy } = cli.flags

  await attemptLogin(apiBaseUrl, apiProxy)
}
