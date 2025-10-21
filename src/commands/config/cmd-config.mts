import type { CliSubcommand } from '../../utils/cli/with-subcommands.mjs'
import { meowWithSubcommands } from '../../utils/cli/with-subcommands.mjs'
import { cmdConfigAuto } from './cmd-config-auto.mts'
import { cmdConfigGet } from './cmd-config-get.mts'
import { cmdConfigList } from './cmd-config-list.mts'
import { cmdConfigSet } from './cmd-config-set.mts'
import { cmdConfigUnset } from './cmd-config-unset.mts'

const description = 'Manage Socket CLI configuration'

export const cmdConfig: CliSubcommand = {
  description,
  hidden: false,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        argv,
        name: `${parentName} config`,
        importMeta,
        subcommands: {
          auto: cmdConfigAuto,
          get: cmdConfigGet,
          list: cmdConfigList,
          set: cmdConfigSet,
          unset: cmdConfigUnset,
        },
      },
      { description },
    )
  },
}
