/** @fileoverview Organization parent command for Socket CLI. Manages Socket organization account operations including dependencies, quotas, policies, and organization listing. Delegates to subcommands: dependencies, list, policy, quota. */

import { cmdOrganizationDependencies } from './cmd-organization-dependencies.mts'
import { cmdOrganizationList } from './cmd-organization-list.mts'
import { cmdOrganizationPolicyLicense } from './cmd-organization-policy-license.mts'
import { cmdOrganizationPolicySecurity } from './cmd-organization-policy-security.mts'
import { cmdOrganizationPolicy } from './cmd-organization-policy.mts'
import { cmdOrganizationQuota } from './cmd-organization-quota.mts'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands.mts'

import type { CliSubcommand } from '../../utils/meow-with-subcommands.mts'

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
