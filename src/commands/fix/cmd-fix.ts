import { runFix } from './run-fix.ts'
import { commonFlags } from '../../flags.ts'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting.ts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.ts'

const config: CliCommandConfig = {
  commandName: 'fix',
  description: 'Fix "fixable" Socket alerts',
  hidden: true,
  flags: {
    ...commonFlags
  },
  help: (command, config) => `
    Usage
      $ ${command}

    Options
      ${getFlagListOutput(config.flags, 6)}
  `
}

export const cmdFix = {
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

  await runFix()
}
