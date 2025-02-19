import meowOrExit from 'meow'

import { runRawNpx } from './run-raw-npx.ts'
import constants from '../../constants'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.ts'

const { NPX } = constants

const config: CliCommandConfig = {
  commandName: 'raw-npx',
  description: `Temporarily disable the Socket ${NPX} wrapper`,
  hidden: false,
  flags: {},
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName} <command>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${parentName} ${config.commandName} install
  `
}

export const cmdRawNpx = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: ReadonlyArray<string>,
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  meowOrExit(config.help(parentName, config), {
    argv,
    description: config.description,
    importMeta,
    flags: config.flags
  })

  await runRawNpx(argv)
}
