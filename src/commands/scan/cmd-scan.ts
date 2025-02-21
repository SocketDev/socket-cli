import { cmdScanCreate } from './cmd-scan-create.ts'
import { cmdScanDelete } from './cmd-scan-delete.ts'
import { cmdScanList } from './cmd-scan-list.ts'
import { cmdScanMetadata } from './cmd-scan-metadata.ts'
import { cmdScanStream } from './cmd-scan-stream.ts'
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
        del: cmdScanDelete,
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
