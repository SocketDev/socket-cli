import meowOrExit from 'meow'

import { getOrganizations } from './get-organizations.ts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.ts'

const config: CliCommandConfig = {
  commandName: 'organizations',
  description: 'List organizations associated with the API key used',
  hidden: false,
  flags: {},
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName}
  `
}

export const cmdOrganizations = {
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

  await getOrganizations()
}
