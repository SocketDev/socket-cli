import type { CliSubcommand } from '../../utils/cli/with-subcommands.mjs'
import { meowWithSubcommands } from '../../utils/cli/with-subcommands.mjs'
import { cmdInstallCompletion } from './cmd-install-completion.mts'

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
