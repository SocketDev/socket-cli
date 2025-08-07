import isInteractive from '@socketregistry/is-interactive/index.cjs'
import { logger } from '@socketsecurity/registry/lib/logger'

import { attemptLogin } from './attempt-login.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { InputError } from '../../utils/errors.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'login',
  description: 'Setup Socket CLI with an API token and defaults',
  hidden: false,
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
      - Quota: 1 unit

    Logs into the Socket API by prompting for an API token

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} --api-proxy=http://localhost:1234
  `,
}

export const cmdLogin = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const apiBaseUrl = cli.flags['apiBaseUrl'] as string | undefined
  const apiProxy = cli.flags['apiProxy'] as string | undefined

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  if (!isInteractive()) {
    throw new InputError(
      'Cannot prompt for credentials in a non-interactive shell',
    )
  }

  await attemptLogin(apiBaseUrl, apiProxy)
}
