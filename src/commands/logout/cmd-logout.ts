import meowOrExit from 'meow'

import { attemptLogout } from './attempt-logout.ts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.ts'

const config: CliCommandConfig = {
  commandName: 'logout',
  description: 'Socket API logout',
  hidden: false,
  flags: {},
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName}

    Logs out of the Socket API and clears all Socket credentials from disk

    Examples
      $ ${parentName} ${config.commandName}
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
  meowOrExit(config.help(parentName, config), {
    argv,
    description: config.description,
    importMeta,
    flags: config.flags
  })

  attemptLogout()
}
