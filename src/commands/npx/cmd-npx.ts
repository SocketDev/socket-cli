import meowOrExit from 'meow'

import { wrapNpx } from './wrap-npx.ts'
import constants from '../../constants'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.ts'

const { NPX } = constants

const config: CliCommandConfig = {
  commandName: 'npx',
  description: `${NPX} wrapper functionality`,
  hidden: false,
  flags: {},
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName}
  `
}

export const cmdNpx = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  meowOrExit(config.help(parentName, config), {
    argv,
    description: config.description,
    importMeta,
    flags: config.flags
  })

  await wrapNpx(argv)
}
