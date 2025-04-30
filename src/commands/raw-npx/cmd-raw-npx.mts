import { logger } from '@socketsecurity/registry/lib/logger'

import { runRawNpx } from './run-raw-npx.mts'
import constants from '../../constants.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAIL_TEXT, NPX } = constants

const config: CliCommandConfig = {
  commandName: 'raw-npx',
  description: `Temporarily disable the Socket ${NPX} wrapper`,
  hidden: false,
  flags: {},
  help: command => `
    Usage
      $ ${command} <command>

    Examples
      $ ${command} install
  `
}

export const cmdRawNpx = {
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
    allowUnknownFlags: true,
    argv,
    config,
    importMeta,
    parentName
  })

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await runRawNpx(argv)
}
