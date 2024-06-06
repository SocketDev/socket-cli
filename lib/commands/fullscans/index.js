import { create } from './create.js'
import { deleteFullScan } from './delete.js'
import { list } from './list.js'
import { stream } from './stream.js'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands.js'

const description = 'Full scans related commands'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const fullscans = {
  description,
  run: async (argv, importMeta, { parentName }) => {
    await meowWithSubcommands(
      {
        create,
        stream,
        list,
        deleteFullScan
      },
      {
        argv,
        description,
        importMeta,
        name: parentName + ' full-scans',
      }
    )
  }
}
