import { cmdReposCreate } from './cmd-repos-create'
import { cmdReposDel } from './cmd-repos-del'
import { cmdReposList } from './cmd-repos-list'
import { cmdReposUpdate } from './cmd-repos-update'
import { cmdReposView } from './cmd-repos-view'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

const description = 'Repositories related commands'

export const cmdRepos: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        create: cmdReposCreate,
        view: cmdReposView,
        list: cmdReposList,
        del: cmdReposDel,
        update: cmdReposUpdate
      },
      {
        argv,
        description,
        importMeta,
        name: `${parentName} repos`
      }
    )
  }
}
