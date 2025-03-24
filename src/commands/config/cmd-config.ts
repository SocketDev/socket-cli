import { cmdConfigGet } from './cmd-config-get'
import { cmdConfigList } from './cmd-config-list'
import { cmdConfigSet } from './cmd-config-set'
import { cmdConfigUnset } from './cmd-config-unset'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

const description = 'Commands related to the local CLI configuration'

export const cmdConfig: CliSubcommand = {
  description,
  hidden: true, // [beta]
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        unset: cmdConfigUnset,
        get: cmdConfigGet,
        list: cmdConfigList,
        set: cmdConfigSet
      },
      {
        argv,
        description,
        importMeta,
        name: `${parentName} config`
      }
    )
  }
}
