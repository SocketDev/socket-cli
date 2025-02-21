import { getOrganizations } from './get-organizations.ts'
import { meowOrExit } from '../../utils/meow-with-subcommands'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.ts'

const config: CliCommandConfig = {
  commandName: 'organizations',
  description: 'List organizations associated with the API key used',
  hidden: false,
  flags: {},
  help: (command, _config) => `
    Usage
      $ ${command}
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
  meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  await getOrganizations()
}
