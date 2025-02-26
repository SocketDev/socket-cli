import { commonFlags } from '../../flags.ts'
import { meowOrExit } from '../../utils/meow-with-subcommands.ts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.ts'

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

  if (cli.flags['dryRun']) return console.log('[DryRun] Bailing now')

  throw new Error('This error was intentionally left blank')
}
