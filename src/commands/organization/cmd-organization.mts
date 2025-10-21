import type { CliSubcommand } from '../../utils/cli/with-subcommands.mjs'
import { meowWithSubcommands } from '../../utils/cli/with-subcommands.mjs'
import { cmdOrganizationDependencies } from './cmd-organization-dependencies.mts'
import { cmdOrganizationList } from './cmd-organization-list.mts'
import { cmdOrganizationPolicy } from './cmd-organization-policy.mts'
import { cmdOrganizationPolicyLicense } from './cmd-organization-policy-license.mts'
import { cmdOrganizationPolicySecurity } from './cmd-organization-policy-security.mts'
import { cmdOrganizationQuota } from './cmd-organization-quota.mts'

const description = 'Manage Socket organization account details'

export const cmdOrganization: CliSubcommand = {
  description,
  hidden: false,
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        argv,
        name: `${parentName} organization`,
        importMeta,
        subcommands: {
          dependencies: cmdOrganizationDependencies,
          list: cmdOrganizationList,
          quota: cmdOrganizationQuota,
          policy: cmdOrganizationPolicy,
        },
      },
      {
        aliases: {
          deps: {
            description: cmdOrganizationDependencies.description,
            hidden: true,
            argv: ['dependencies'],
          },
          license: {
            description: cmdOrganizationPolicyLicense.description,
            hidden: true,
            argv: ['policy', 'license'],
          },
          security: {
            description: cmdOrganizationPolicySecurity.description,
            hidden: true,
            argv: ['policy', 'security'],
          },
        },
        description,
      },
    )
  },
}
