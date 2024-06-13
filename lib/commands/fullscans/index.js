import { create } from './create.js'
import { del } from './delete.js'
import { list } from './list.js'
import { stream } from './stream.js'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands.js'

const description = 'Scans related commands'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const fullscans = {
  description,
  run: async (argv, importMeta, { parentName }) => {
    await meowWithSubcommands(
      {
        create,
        stream,
        list,
        del
      },
      {
        argv,
        description,
        importMeta,
        name: parentName + ' scan',
      }
    )
  }
}
