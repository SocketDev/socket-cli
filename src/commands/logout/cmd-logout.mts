/** @fileoverview Logout command implementation for Socket CLI. Clears Socket API authentication credentials and enforced organization policies from configuration. Removes all persisted Socket credentials from disk. */

import { logger } from '@socketsecurity/registry/lib/logger'

import { attemptLogout } from './attempt-logout.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

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
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  attemptLogout()
}
