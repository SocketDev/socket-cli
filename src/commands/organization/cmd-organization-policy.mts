import type { CliSubcommand } from '../../utils/cli/with-subcommands.mjs'
import { meowWithSubcommands } from '../../utils/cli/with-subcommands.mjs'
import { cmdOrganizationPolicyLicense } from './cmd-organization-policy-license.mts'
import { cmdOrganizationPolicySecurity } from './cmd-organization-policy-security.mts'

const description = 'Organization policy details'

export const cmdOrganizationPolicy: CliSubcommand = {
  description,
  // Hidden because it was broken all this time (nobody could be using it)
  // and we're not sure if it's useful to anyone in its current state.
  // Until we do, we'll hide this to keep the help tidier.
  // And later, we may simply move this under `scan`, anyways.
  hidden: false,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        argv,
        name: `${parentName} policy`,
        importMeta,
        subcommands: {
          security: cmdOrganizationPolicySecurity,
          license: cmdOrganizationPolicyLicense,
        },
      },
      {
        description,
        defaultSub: 'list', // Backwards compat
      },
    )
  },
}
