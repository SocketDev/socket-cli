import { cmdDiffScanGet } from './cmd-diff-scan-get.mts'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands.mts'

import type { CliSubcommand } from '../../utils/meow-with-subcommands.mts'

const description = 'Diff scans related commands'

export const cmdDiffScan: CliSubcommand = {
  description,
  // Hidden because it was broken all this time (nobody could be using it)
  // and we're not sure if it's useful to anyone in its current state.
  // Until we do, we'll hide this to keep the help tidier.
  // And later, we may simply move this under `scan`, anyways.
  hidden: true,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        get: cmdDiffScanGet,
      },
      {
        argv,
        description,
        importMeta,
        name: parentName + ' diff-scan',
      },
    )
  },
}
