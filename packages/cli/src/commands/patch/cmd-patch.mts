import { cmdPatchApply } from './cmd-patch-apply.mts'
import { cmdPatchCleanup } from './cmd-patch-cleanup.mts'
import { cmdPatchDiscover } from './cmd-patch-discover.mts'
import { cmdPatchDownload } from './cmd-patch-download.mts'
import { cmdPatchGet } from './cmd-patch-get.mts'
import { cmdPatchInfo } from './cmd-patch-info.mts'
import { cmdPatchList } from './cmd-patch-list.mts'
import { cmdPatchRm } from './cmd-patch-rm.mts'
import { cmdPatchStatus } from './cmd-patch-status.mts'
import { meowWithSubcommands } from '../../utils/cli/with-subcommands.mjs'

import type { CliSubcommand } from '../../utils/cli/with-subcommands.mjs'

const description = 'Manage CVE patches for dependencies'

const hidden = false

export const cmdPatch: CliSubcommand = {
  description,
  hidden,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        argv,
        name: `${parentName} patch`,
        importMeta,
        subcommands: {
          apply: cmdPatchApply,
          cleanup: cmdPatchCleanup,
          discover: cmdPatchDiscover,
          download: cmdPatchDownload,
          get: cmdPatchGet,
          info: cmdPatchInfo,
          list: cmdPatchList,
          rm: cmdPatchRm,
          status: cmdPatchStatus,
        },
      },
      {
        description,
      },
    )
  },
}
