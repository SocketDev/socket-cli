import { cmdOrganizationList } from './cmd-organization-list.mts'
import { cmdOrganizationPolicyLicense } from './cmd-organization-policy-license.mts'
import { cmdOrganizationPolicyPolicy } from './cmd-organization-policy-security.mts'
import { cmdOrganizationPolicy } from './cmd-organization-policy.mts'
import { cmdOrganizationQuota } from './cmd-organization-quota.mts'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands.mts'

import type { CliSubcommand } from '../../utils/meow-with-subcommands.mts'

const description = 'Account details'

export const cmdOrganization: CliSubcommand = {
  description,
  hidden: false,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        list: cmdOrganizationList,
        quota: cmdOrganizationQuota,
        policy: cmdOrganizationPolicy,
      },
      {
        aliases: {
          license: {
            description: cmdOrganizationPolicyLicense.description,
            hidden: true,
            argv: ['policy', 'license'],
          },
          security: {
            description: cmdOrganizationPolicyPolicy.description,
            hidden: true,
            argv: ['policy', 'security'],
          },
        },
        argv,
        description,
        defaultSub: 'list', // Backwards compat
        importMeta,
        name: parentName + ' organization',
      },
    )
  },
}
