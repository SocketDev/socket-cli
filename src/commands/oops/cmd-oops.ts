import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { commonFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'oops',
  description: 'Trigger an intentional error (for development)',
  hidden: true,
  flags: {
    ...commonFlags
  },
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName}

    Don't run me.
  `
}

export const cmdOops = {
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

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  throw new Error('This error was intentionally left blank')
}
