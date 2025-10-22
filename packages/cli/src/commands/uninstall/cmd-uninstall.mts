import { cmdUninstallCompletion } from './cmd-uninstall-completion.mts'
import { meowWithSubcommands } from '../../utils/cli/with-subcommands.mjs'

import type { CliSubcommand } from '../../utils/cli/with-subcommands.mjs'

const description = 'Uninstall Socket CLI tab completion'

export const cmdUninstall: CliSubcommand = {
  description,
  hidden: false,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        argv,
        name: `${parentName} uninstall`,
        importMeta,
        subcommands: {
          completion: cmdUninstallCompletion,
        },
      },
      { description },
    )
  },
}
