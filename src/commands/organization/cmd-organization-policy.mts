import { cmdOrganizationPolicyLicense } from './cmd-organization-policy-license.mts'
import { cmdOrganizationPolicyPolicy } from './cmd-organization-policy-security.mts'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands.mts'

import type { CliSubcommand } from '../../utils/meow-with-subcommands.mts'

const description = 'Organization policy details'

export const cmdOrganizationPolicy: CliSubcommand = {
  description,
  // Hidden because it was broken all this time (nobody could be using it)
  // and we're not sure if it's useful to anyone in its current state.
  // Until we do, we'll hide this to keep the help tidier.
  // And later, we may simply move this under `scan`, anyways.
  hidden: true,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        security: cmdOrganizationPolicyPolicy,
        license: cmdOrganizationPolicyLicense
      },
      {
        argv,
        description,
        defaultSub: 'list', // Backwards compat
        importMeta,
        name: parentName + ' policy'
      }
    )
  }
}
