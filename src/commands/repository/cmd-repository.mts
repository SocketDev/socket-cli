import { cmdRepositoryCreate } from './cmd-repository-create.mts'
import { cmdRepositoryDel } from './cmd-repository-del.mts'
import { cmdRepositoryList } from './cmd-repository-list.mts'
import { cmdRepositoryUpdate } from './cmd-repository-update.mts'
import { cmdRepositoryView } from './cmd-repository-view.mts'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands.mts'

import type { CliSubcommand } from '../../utils/meow-with-subcommands.mts'

const description = 'Manage registered repositories'

export const cmdRepository: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        create: cmdRepositoryCreate,
        view: cmdRepositoryView,
        list: cmdRepositoryList,
        del: cmdRepositoryDel,
        update: cmdRepositoryUpdate,
      },
      {
        argv,
        description,
        importMeta,
        name: `${parentName} repository`,
      },
    )
  },
}
