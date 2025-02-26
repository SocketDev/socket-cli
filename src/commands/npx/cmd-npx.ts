import { wrapNpx } from './wrap-npx'
import constants from '../../constants'
import { meowOrExit } from '../../utils/meow-with-subcommands'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { NPX } = constants

const config: CliCommandConfig = {
  commandName: 'npx',
  description: `${NPX} wrapper functionality`,
  hidden: false,
  flags: {},
  help: (command, _config) => `
    Usage
      $ ${command}
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
  const cli = meowOrExit({
    allowUnknownFlags: true,
    argv,
    config,
    importMeta,
    parentName
  })

  if (cli.flags['dryRun']) return console.log('[DryRun] Bailing now')

  await wrapNpx(argv)
}
