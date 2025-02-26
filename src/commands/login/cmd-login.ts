import isInteractive from '@socketregistry/is-interactive/index.cjs'

import { attemptLogin } from './attempt-login.ts'
import { commonFlags } from '../../flags.ts'
import { InputError } from '../../utils/errors'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.ts'

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
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  const isDryRun = cli.flags['dryRun']

  if (!isInteractive() && !isDryRun) {
    throw new InputError(
      'Cannot prompt for credentials in a non-interactive shell'
    )
  }

  let apiBaseUrl = cli.flags['apiBaseUrl'] as string | undefined
  let apiProxy = cli.flags['apiProxy'] as string | undefined

  if (isDryRun) return console.log('[DryRun] Bailing now')

  await attemptLogin(apiBaseUrl, apiProxy)
}
