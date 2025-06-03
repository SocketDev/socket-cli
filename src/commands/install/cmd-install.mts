import { cmdInstallCompletion } from './cmd-install-completion.mts'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands.mts'

import type { CliSubcommand } from '../../utils/meow-with-subcommands.mts'

const description = 'Setup the Socket CLI command in your environment'

export const cmdInstall: CliSubcommand = {
  description,
  hidden: true, // beta; isTestingV1
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        completion: cmdInstallCompletion,
      },
      {
        argv,
        description,
        importMeta,
        name: `${parentName} install`,
      },
    )
  },
}
