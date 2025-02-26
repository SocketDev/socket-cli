import { cmdReportCreate } from './cmd-report-create'
import { cmdReportView } from './cmd-report-view'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

const description = '[Deprecated] Project report related commands'

export const cmdReport: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        create: cmdReportCreate,
        view: cmdReportView
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
