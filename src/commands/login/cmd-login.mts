import isInteractive from '@socketregistry/is-interactive/index.cjs'
import { logger } from '@socketsecurity/registry/lib/logger'

import { attemptLogin } from './attempt-login.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { InputError } from '../../utils/errors.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output-formatting.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

export const CMD_NAME = 'login'

const description = 'Sign in to Socket and configure the CLI'

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
      apiToken: {
        type: 'boolean',
        default: false,
        description: 'Use masked API-token login for scans and write commands',
      },
      apiBaseUrl: {
        type: 'string',
        default: '',
        description: 'API server for API-token login',
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

    By default, opens a browser for read-only package, alert, and threat-feed
    access. Use --api-token for scans and write operations. A sign-in URL is
    printed so you can open it manually if the browser does not launch.

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} --api-token
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
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  const apiTokenMode = !!cli.flags['apiToken']
  if (!isInteractive()) {
    throw new InputError(
      'Login requires an interactive terminal. Set SOCKET_CLI_API_TOKEN for automation.',
    )
  }

  const { apiBaseUrl, apiProxy } = cli.flags as {
    apiBaseUrl?: string | undefined
    apiProxy?: string | undefined
  }

  await attemptLogin(apiBaseUrl, apiProxy, apiTokenMode)
}
