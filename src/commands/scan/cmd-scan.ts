import { cmdScanCreate } from './cmd-scan-create'
import { cmdScanDel } from './cmd-scan-del'
import { cmdScanList } from './cmd-scan-list'
import { cmdScanMetadata } from './cmd-scan-metadata'
import { cmdScanStream } from './cmd-scan-stream'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

const description = 'Scans related commands'

export const cmdScan: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        create: cmdScanCreate,
        stream: cmdScanStream,
        list: cmdScanList,
        del: cmdScanDel,
        metadata: cmdScanMetadata
      },
      {
        argv,
        description,
        importMeta,
        name: parentName + ' scan'
      }
    )
  }
}
