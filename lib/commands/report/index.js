import { meowWithSubcommands } from '../../utils/meow-with-subcommands.js'
import { create } from './create.js'
import { view } from './view.js'

const description = 'Project report related commands'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const report = {
  description,
  run: async (argv, importMeta, { parentName }) => {
    await meowWithSubcommands(
      {
        create,
        view,
      },
      {
        argv,
        description,
        importMeta,
        name: parentName + ' report',
      }
    )
  }
}
