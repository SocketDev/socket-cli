import { cmdPackageScore } from './cmd-package-score'
import { cmdPackageShallow } from './cmd-package-shallow'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

const description = 'Commands relating to looking up published packages'

export const cmdPackage: CliSubcommand = {
  description,
  hidden: true, // [beta]
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        score: cmdPackageScore,
        shallow: cmdPackageShallow
      },
      {
        aliases: {
          deep: {
            description,
            hidden: true,
            argv: ['score']
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
