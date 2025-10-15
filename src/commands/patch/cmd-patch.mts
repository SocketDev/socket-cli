import { cmdPatchApply } from './cmd-patch-apply.mts'
import { cmdPatchCleanup } from './cmd-patch-cleanup.mts'
import { cmdPatchGet } from './cmd-patch-get.mts'
import { cmdPatchInfo } from './cmd-patch-info.mts'
import { cmdPatchList } from './cmd-patch-list.mts'
import { cmdPatchRm } from './cmd-patch-rm.mts'
import { meowWithSubcommands } from '../../utils/cli/with-subcommands.mjs'

import type { CliSubcommand } from '../../utils/cli/with-subcommands.mjs'

const description = 'Manage CVE patches for dependencies'

const hidden = true

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
          get: cmdPatchGet,
          info: cmdPatchInfo,
          list: cmdPatchList,
          rm: cmdPatchRm,
        },
      },
      {
        description,
      },
    )
  },
}
