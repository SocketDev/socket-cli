import { cmdDiffScanGet } from './cmd-diff-scan-get'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

const description = 'Diff scans related commands'

export const cmdDiffScan: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        get: cmdDiffScanGet
      },
      {
        argv,
        description,
        importMeta,
        name: parentName + ' diff-scan'
      }
    )
  }
}
