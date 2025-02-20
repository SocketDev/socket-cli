import { runRawNpx } from './run-raw-npx.ts'
import constants from '../../constants'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.ts'

const { NPX } = constants

const config: CliCommandConfig = {
  commandName: 'raw-npx',
  description: `Temporarily disable the Socket ${NPX} wrapper`,
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
  meowOrExit({
    allowUnknownFlags: true,
    argv,
    config,
    importMeta,
    parentName
  })

  await runRawNpx(argv)
}
