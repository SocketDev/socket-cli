import type { CliSubcommand } from '../../utils/cli/with-subcommands.mjs'
import { meowWithSubcommands } from '../../utils/cli/with-subcommands.mjs'
import { cmdRepositoryCreate } from './cmd-repository-create.mts'
import { cmdRepositoryDel } from './cmd-repository-del.mts'
import { cmdRepositoryList } from './cmd-repository-list.mts'
import { cmdRepositoryUpdate } from './cmd-repository-update.mts'
import { cmdRepositoryView } from './cmd-repository-view.mts'

const description = 'Manage registered repositories'

export const cmdRepository: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        argv,
        name: `${parentName} repository`,
        importMeta,
        subcommands: {
          create: cmdRepositoryCreate,
          view: cmdRepositoryView,
          list: cmdRepositoryList,
          del: cmdRepositoryDel,
          update: cmdRepositoryUpdate,
        },
      },
      { description },
    )
  },
}
