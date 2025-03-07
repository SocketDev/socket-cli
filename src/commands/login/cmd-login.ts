import isInteractive from '@socketregistry/is-interactive/index.cjs'
import { logger } from '@socketsecurity/registry/lib/logger'

import { attemptLogin } from './attempt-login'
import constants from '../../constants'
import { commonFlags } from '../../flags'
import { InputError } from '../../utils/errors'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'login',
  description: 'Socket API login',
  hidden: false,
  flags: {
    ...commonFlags,
    apiBaseUrl: {
      type: 'string',
      description: 'API server to connect to for login'
    },
    apiProxy: {
      type: 'string',
      description: 'Proxy to use when making connection to API server'
    }
  },
  help: (command, config) => `
    Usage
      $ ${command}

    Logs into the Socket API by prompting for an API key

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command}
      $ ${command} --api-proxy=http://localhost:1234
  `
}

export const cmdLogin = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  const apiBaseUrl = cli.flags['apiBaseUrl'] as string | undefined
  const apiProxy = cli.flags['apiProxy'] as string | undefined

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  if (!isInteractive()) {
    throw new InputError(
      'Cannot prompt for credentials in a non-interactive shell'
    )
  }

  await attemptLogin(apiBaseUrl, apiProxy)
}
