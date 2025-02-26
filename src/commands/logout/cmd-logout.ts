import { attemptLogout } from './attempt-logout.ts'
import { commonFlags } from '../../flags.ts'
import { meowOrExit } from '../../utils/meow-with-subcommands'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.ts'

const config: CliCommandConfig = {
  commandName: 'logout',
  description: 'Socket API logout',
  hidden: false,
  flags: {
    ...commonFlags
  },
  help: (command, _config) => `
    Usage
      $ ${command}

    Logs out of the Socket API and clears all Socket credentials from disk
  `
}

export const cmdLogout = {
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

  attemptLogout()
}
