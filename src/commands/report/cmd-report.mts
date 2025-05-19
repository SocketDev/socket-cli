import { cmdReportCreate } from './cmd-report-create.mts'
import { cmdReportView } from './cmd-report-view.mts'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands.mts'

import type { CliSubcommand } from '../../utils/meow-with-subcommands.mts'

const description = '[Deprecated] Project report related commands'

export const cmdReport: CliSubcommand = {
  description,
  hidden: true, // Deprecated in favor of `scan`
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        create: cmdReportCreate,
        view: cmdReportView,
      },
      {
        argv,
        description,
        importMeta,
        name: parentName + ' report',
      },
    )
  },
}
