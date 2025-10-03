/** @fileoverview Config parent command for Socket CLI. Manages Socket CLI configuration including API tokens, organization settings, and preferences. Delegates to subcommands: auto, get, set, unset, list. */

import { cmdConfigAuto } from './cmd-config-auto.mts'
import { cmdConfigGet } from './cmd-config-get.mts'
import { cmdConfigList } from './cmd-config-list.mts'
import { cmdConfigSet } from './cmd-config-set.mts'
import { cmdConfigUnset } from './cmd-config-unset.mts'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands.mts'

import type { CliSubcommand } from '../../utils/meow-with-subcommands.mts'

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
