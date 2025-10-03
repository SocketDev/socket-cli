/** @fileoverview Uninstall parent command for Socket CLI. Manages removal of Socket CLI features including tab completion. Delegates to subcommands: completion. */

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
