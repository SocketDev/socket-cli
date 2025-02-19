import meowOrExit from 'meow'

import { wrapNpm } from './wrap-npm.ts'
import constants from '../../constants'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { NPM } = constants

const config: CliCommandConfig = {
  commandName: 'npm',
  description: `${NPM} wrapper functionality`,
  hidden: false,
  flags: {},
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName}
  `
}

export const cmdNpm = {
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

  await wrapNpm(argv)
}
