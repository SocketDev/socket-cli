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

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

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
  { parentName }: { parentName: string },
): Promise<void> {
  const config: CliCommandConfig = {
    commandName: 'login',
    description,
    hidden,
    flags: {
      ...commonFlags,
      apiBaseUrl: {
        type: 'string',
        description: 'API server to connect to for login',
      },
      apiProxy: {
        type: 'string',
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
    importMeta,
    parentName,
  })

  const dryRun = !!cli.flags['dryRun']

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  if (!isInteractive()) {
    throw new InputError(
      'Cannot prompt for credentials in a non-interactive shell',
    )
  }

  const apiBaseUrl = cli.flags['apiBaseUrl'] as string | undefined

  const apiProxy = cli.flags['apiProxy'] as string | undefined

  await attemptLogin(apiBaseUrl, apiProxy)
}
