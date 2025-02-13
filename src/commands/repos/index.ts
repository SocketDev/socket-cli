import { create } from './create'
import { del } from './delete'
import { list } from './list'
import { update } from './update'
import { view } from './view'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

const description = 'Repositories related commands'

export const reposCommand: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        create,
        view,
        list,
        del,
        update
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
