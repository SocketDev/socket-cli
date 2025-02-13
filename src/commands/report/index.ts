import { create } from './create'
import { view } from './view'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

const description = '[Deprecated] Project report related commands'

export const reportCommand: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        create,
        view
      },
      {
        argv,
        description,
        importMeta,
        name: parentName + ' report'
      }
    )
  }
}
