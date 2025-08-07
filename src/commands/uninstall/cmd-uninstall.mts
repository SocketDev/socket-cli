import { cmdUninstallCompletion } from './cmd-uninstall-completion.mts'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands.mts'

import type { CliSubcommand } from '../../utils/meow-with-subcommands.mts'

const description = 'Uninstall Socket CLI tab completion'

export const cmdUninstall: CliSubcommand = {
  description,
  hidden: false,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        completion: cmdUninstallCompletion,
      },
      {
        argv,
        description,
        importMeta,
        name: `${parentName} uninstall`,
      },
    )
  },
}
