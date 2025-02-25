import { cmdReposCreate } from './cmd-repos-create.ts'
import { cmdReposDelete } from './cmd-repos-delete.ts'
import { cmdReposList } from './cmd-repos-list.ts'
import { cmdReposUpdate } from './cmd-repos-update.ts'
import { cmdReposView } from './cmd-repos-view.ts'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

const description = 'Repositories related commands'

export const cmdRepos: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        cmdReposCreate,
        cmdReposView,
        cmdReposList,
        cmdReposDelete,
        cmdReposUpdate
      },
      {
        argv,
        description,
        importMeta,
        name: `${parentName} repo`
      }
    )
  }
}
