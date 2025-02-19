import meowOrExit from 'meow'

import isInteractive from '@socketregistry/is-interactive/index.cjs'

import { attemptLogin } from './attempt-login.ts'
import { InputError } from '../../utils/errors'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.ts'

const config: CliCommandConfig = {
  commandName: 'login',
  description: 'Socket API login',
  hidden: false,
  flags: {
    apiBaseUrl: {
      type: 'string',
      description: 'API server to connect to for login'
    },
    apiProxy: {
      type: 'string',
      description: 'Proxy to use when making connection to API server'
    }
  },
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName}

    Logs into the Socket API by prompting for an API key

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${parentName} ${config.commandName}
  `
}

export const cmdLogin = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit(config.help(parentName, config), {
    argv,
    description: config.description,
    importMeta,
    flags: config.flags
  })

  if (!isInteractive()) {
    throw new InputError(
      'Cannot prompt for credentials in a non-interactive shell'
    )
  }

  let apiBaseUrl = cli.flags['apiBaseUrl'] as string | undefined
  let apiProxy = cli.flags['apiProxy'] as string | undefined

  await attemptLogin(apiBaseUrl, apiProxy)
}
