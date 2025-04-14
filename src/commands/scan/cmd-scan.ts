import { cmdScanCreate } from './cmd-scan-create'
import { cmdScanDel } from './cmd-scan-del'
import { cmdScanDiff } from './cmd-scan-diff'
import { cmdScanList } from './cmd-scan-list'
import { cmdScanMetadata } from './cmd-scan-metadata'
import { cmdScanReport } from './cmd-scan-report'
import { cmdScanView } from './cmd-scan-view'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

const description = 'Scan related commands'

export const cmdScan: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        create: cmdScanCreate,
        list: cmdScanList,
        del: cmdScanDel,
        diff: cmdScanDiff,
        metadata: cmdScanMetadata,
        report: cmdScanReport,
        view: cmdScanView
      },
      {
        aliases: {
          // Backwards compat. TODO: Drop next major bump
          stream: {
            description: cmdScanView.description,
            hidden: true,
            argv: ['view'] // Original args will be appended (!)
          }
        },
        argv,
        description,
        importMeta,
        name: parentName + ' scan'
      }
    )
  }
}
