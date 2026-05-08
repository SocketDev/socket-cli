import { cmdPackageScore } from './cmd-package-score.mts'
import { cmdPackageShallow } from './cmd-package-shallow.mts'
import { defineSubcommandGroup } from '../../utils/cli/define-subcommand-group.mts'

const description = 'Look up published package details'

export const cmdPackage = defineSubcommandGroup({
  name: 'package',
  description,
  hidden: false,
  subcommands: {
    score: cmdPackageScore,
    shallow: cmdPackageShallow,
  },
  aliases: {
    deep: {
      description,
      hidden: true,
      argv: ['score'],
    },
  },
})
