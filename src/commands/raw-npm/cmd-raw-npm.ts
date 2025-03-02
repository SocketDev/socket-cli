import { logger } from '@socketsecurity/registry/lib/logger'

import { runRawNpm } from './run-raw-npm'
import constants from '../../constants'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { NPM } = constants

const config: CliCommandConfig = {
  commandName: 'raw-npm',
  description: `Temporarily disable the Socket ${NPM} wrapper`,
  hidden: false,
  flags: {},
  help: (command, config) => `
    Usage
      $ ${command} <command>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} install
  `
}

export const cmdRawNpm = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: ReadonlyArray<string>,
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
    logger.log('[DryRun] Bailing now')
    return
  }

  await runRawNpm(argv)
}
