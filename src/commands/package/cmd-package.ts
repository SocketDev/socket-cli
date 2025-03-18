import { cmdPackageScore } from './cmd-package-score'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

const description = 'Commands relating to looking up published packages'

export const cmdPackage: CliSubcommand = {
  description,
  hidden: true, // [beta]
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        score: cmdPackageScore
      },
      {
        aliases: {
          pkg: {
            description,
            hidden: true,
            argv: []
          }
        },
        argv,
        description,
        importMeta,
        name: parentName + ' package'
      }
    )
  }
}
