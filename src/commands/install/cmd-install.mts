import { cmdInstallCompletion } from './cmd-install-completion.mts'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands.mts'

import type { CliSubcommand } from '../../utils/meow-with-subcommands.mts'

const description = 'Install Socket CLI tab completion'

export const cmdInstall: CliSubcommand = {
  description,
  hidden: false,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        argv,
        name: `${parentName} install`,
        importMeta,
        subcommands: {
          completion: cmdInstallCompletion,
        },
      },
      { description },
    )
  },
}
