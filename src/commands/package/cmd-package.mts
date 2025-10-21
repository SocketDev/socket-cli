import type { CliSubcommand } from '../../utils/cli/with-subcommands.mjs'
import { meowWithSubcommands } from '../../utils/cli/with-subcommands.mjs'
import { cmdPackageScore } from './cmd-package-score.mts'
import { cmdPackageShallow } from './cmd-package-shallow.mts'

const description = 'Look up published package details'

export const cmdPackage: CliSubcommand = {
  description,
  hidden: false,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        argv,
        name: `${parentName} package`,
        importMeta,
        subcommands: {
          score: cmdPackageScore,
          shallow: cmdPackageShallow,
        },
      },
      {
        aliases: {
          deep: {
            description,
            hidden: true,
            argv: ['score'],
          },
        },
        description,
      },
    )
  },
}
