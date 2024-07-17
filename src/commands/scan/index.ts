import { create } from './create'
import { del } from './delete'
import { list } from './list'
import { metadata } from './metadata'
import { stream } from './stream'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

const description = 'Scans related commands'

export const scan: CliSubcommand = {
  description,
  run: async (argv, importMeta, { parentName }) => {
    await meowWithSubcommands(
      {
        create,
        stream,
        list,
        del,
        metadata
      },
      {
        argv,
        description,
        importMeta,
        name: parentName + ' scan'
      }
    )
  }
}
