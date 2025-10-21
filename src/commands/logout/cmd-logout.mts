import { logger } from '@socketsecurity/lib/logger'

import { attemptLogout } from './attempt-logout.mts'
import { DRY_RUN_BAILING_NOW } from '../../constants/cli.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

const config: CliCommandConfig = {
  commandName: 'logout',
  description: 'Socket API logout',
  hidden: false,
  flags: {
    ...commonFlags,
  },
  help: (command, _config) => `
    Usage
      $ ${command} [options]

    Logs out of the Socket API and clears all Socket credentials from disk

    Examples
      $ ${command}
  `,
}

export const cmdLogout = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
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

  attemptLogout()
}
