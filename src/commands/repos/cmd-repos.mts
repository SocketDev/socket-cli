import { cmdReposCreate } from './cmd-repos-create.mts'
import { cmdReposDel } from './cmd-repos-del.mts'
import { cmdReposList } from './cmd-repos-list.mts'
import { cmdReposUpdate } from './cmd-repos-update.mts'
import { cmdReposView } from './cmd-repos-view.mts'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands.mts'

import type { CliSubcommand } from '../../utils/meow-with-subcommands.mts'

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
        update: cmdReposUpdate,
      },
      {
        argv,
        description,
        importMeta,
        name: `${parentName} repos`,
      },
    )
  },
}
