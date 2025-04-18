import { cmdOrganizationList } from './cmd-organization-list'
import { cmdOrganizationPolicy } from './cmd-organization-policy'
import { cmdOrganizationQuota } from './cmd-organization-quota'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

const description = 'Account details'

export const cmdOrganization: CliSubcommand = {
  description,
  // Hidden because it was broken all this time (nobody could be using it)
  // and we're not sure if it's useful to anyone in its current state.
  // Until we do, we'll hide this to keep the help tidier.
  // And later, we may simply move this under `scan`, anyways.
  hidden: true,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        list: cmdOrganizationList,
        quota: cmdOrganizationQuota,
        policy: cmdOrganizationPolicy
      },
      {
        argv,
        description,
        defaultSub: 'list', // Backwards compat
        importMeta,
        name: parentName + ' organization'
      }
    )
  }
}
