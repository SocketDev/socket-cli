import { create } from './create.js'
import { del } from './delete.js'
import { list } from './list.js'
import { update } from './update.js'
import { view } from './view.js'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands.js'

const description = 'Repositories related commands'

/** @type {import('../../utils/meow-with-subcommands.js').CliSubcommand} */
export const repo = {
  description,
  run: async (argv, importMeta, { parentName }) => {
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
        name: parentName + ' repo',
      }
    )
  }
}
