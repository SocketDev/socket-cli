import { cmdScanCreate } from './cmd-create'
import { cmdScanDelete } from './cmd-delete.ts'
import { cmdScanList } from './cmd-list.ts'
import { cmdScanMetadata } from './cmd-metadata.ts'
import { cmdScanStream } from './cmd-stream.ts'
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
