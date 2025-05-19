import { cmdUninstallCompletion } from './cmd-uninstall-completion.mts'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands.mts'

import type { CliSubcommand } from '../../utils/meow-with-subcommands.mts'

const description = 'Teardown the Socket command from your environment'

export const cmdUninstall: CliSubcommand = {
  description,
  hidden: true, // beta
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        completion: cmdUninstallCompletion
      },
      {
        argv,
        description,
        importMeta,
        name: `${parentName} uninstall`
      }
    )
  }
}
