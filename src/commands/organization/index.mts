/** @fileoverview Consolidated organization commands using DRY utilities */

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { orgApi } from '../../utils/api-wrapper.mts'
import { buildCommand, buildParentCommand } from '../../utils/command-builder.mts'
import { runStandardValidations } from '../../utils/common-validations.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { commonColumns, simpleOutput } from '../../utils/simple-output.mts'

import type { QuotaData } from '../../utils/api-types.mts'


// @ts-ignore

// List organizations
const cmdList = buildCommand({
  name: 'list',
  description: 'List all organizations',
  includeOutputFlags: true,
  handler: async ({ flags }) => {
    const { dryRun, json, markdown } = flags
    const outputKind = getOutputKind(json, markdown)

    if (!runStandardValidations({
      requireAuth: true,
      dryRun,
      outputKind,
    })) {return}

    const result = await orgApi.list()

    simpleOutput(result, outputKind, {
      table: {
        columns: [
          commonColumns.id,
          commonColumns.name,
          { field: 'plan', name: colors.magenta('Plan') },
          { field: 'role', name: colors.magenta('Role') },
        ],
        rows: data => {
          // Handle the organizations object structure
          const typedData = data as Record<string, unknown>
          if (typedData && typeof typedData === 'object' && 'organizations' in typedData) {
            const orgs = typedData['organizations'] as Record<string, unknown>
            return Object.values(orgs)
          }
          return Array.isArray(data) ? data : []
        },
      },
      emptyMessage: 'No organizations found',
    })
  },
})

// Organization dependencies
const cmdDependencies = buildCommand({
  name: 'dependencies',
  description: 'View organization dependencies',
  includeOutputFlags: true,
  flags: {
    org: {
      type: 'string',
      default: '',
      description: 'Organization slug',
    },
    limit: {
      type: 'number',
      default: 100,
      description: 'Maximum results',
    },
    offset: {
      type: 'number',
      default: 0,
      description: 'Results offset',
    },
  },
  handler: async ({ flags }) => {
    const { dryRun, json, limit, markdown, offset, org: orgFlag } = flags
    const outputKind = getOutputKind(json, markdown)
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)

    if (!runStandardValidations({
      requireOrg: orgSlug,
      requireAuth: true,
      dryRun,
      outputKind,
    })) {return}

    const result = await orgApi.dependencies(orgSlug, { limit, offset })

    simpleOutput(result, outputKind, {
      table: {
        columns: [
          { field: 'name', name: colors.magenta('Package') },
          { field: 'version', name: colors.magenta('Version') },
          { field: 'ecosystem', name: colors.magenta('Ecosystem') },
          { field: 'direct', name: colors.magenta('Direct'), transform: v => v ? '✓' : '' },
        ],
        rows: data => (data as any).rows || (data as any).dependencies || [],
      },
      emptyMessage: 'No dependencies found',
    })
  },
})

// Organization quota
const cmdQuota = buildCommand({
  name: 'quota',
  description: 'View organization quota and usage',
  includeOutputFlags: true,
  flags: {
    org: {
      type: 'string',
      default: '',
      description: 'Organization slug',
    },
  },
  handler: async ({ flags }) => {
    const { dryRun, json, markdown, org: orgFlag } = flags
    const outputKind = getOutputKind(json, markdown)
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)

    if (!runStandardValidations({
      requireOrg: orgSlug,
      requireAuth: true,
      dryRun,
      outputKind,
    })) {return}

    const result = await orgApi.quota()

    simpleOutput(result, outputKind, {
      text: data => {
        logger.log(colors.cyan('Organization Quota'))
        logger.log('')

        // The API returns { quota: number }
        const quotaData = data as QuotaData
        const quotaValue = quotaData.quota
        if (quotaValue !== undefined) {
          logger.log(`Available quota: ${quotaValue}`)
        }

        // If there are additional fields, display them
        if (quotaData.seats_used !== undefined || quotaData.seats_total !== undefined) {
          const quotaInfo = [
            ['Seats', `${quotaData.seats_used || 0} / ${quotaData.seats_total || 'Unlimited'}`],
            ['Repos', `${quotaData.repos_used || 0} / ${quotaData.repos_total || 'Unlimited'}`],
            ['Scans', `${quotaData.scans_used || 0} / ${quotaData.scans_total || 'Unlimited'}`],
          ]

          for (const [label, value] of quotaInfo) {
            logger.log(`${label}: ${value}`)
          }

          if (quotaData.seats_total && quotaData.seats_used && quotaData.seats_used >= quotaData.seats_total * 0.9) {
            logger.log('')
            logger.warn('Approaching seat limit!')
          }
        }
      },
    })
  },
})

// Security policy
const cmdSecurityPolicy = buildCommand({
  name: 'security',
  description: 'View organization security policy',
  includeOutputFlags: true,
  flags: {
    org: {
      type: 'string',
      default: '',
      description: 'Organization slug',
    },
  },
  handler: async ({ flags }) => {
    const { dryRun, json, markdown, org: orgFlag } = flags
    const outputKind = getOutputKind(json, markdown)
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)

    if (!runStandardValidations({
      requireOrg: orgSlug,
      requireAuth: true,
      dryRun,
      outputKind,
    })) {return}

    const result = await orgApi.securityPolicy(orgSlug)

    simpleOutput(result, outputKind, {
      text: data => {
        logger.log(colors.cyan('Security Policy'))
        logger.log('')

        const anyData = data as any
        // Check for securityPolicyRules or rules field
        const rules = anyData.securityPolicyRules || anyData.rules

        if (rules && typeof rules === 'object') {
          const ruleEntries = Object.entries(rules)
          if (ruleEntries.length > 0) {
            for (const [name, rule] of ruleEntries) {
              const ruleObj = rule as any
              const action = ruleObj.action || 'unknown'
              const actionColor = action === 'error' ? colors.red :
                               action === 'warn' ? colors.yellow :
                               action === 'monitor' ? colors.cyan : colors.gray
              logger.log(`• ${name}: ${actionColor(action)}`)
            }
          } else {
            logger.log('No security policies configured')
          }
        } else {
          logger.log('No security policies configured')
        }

        if (anyData.securityPolicyDefault) {
          logger.log(`\nDefault policy: ${anyData.securityPolicyDefault}`)
        }
      },
    })
  },
})

// License policy
const cmdLicensePolicy = buildCommand({
  name: 'license',
  description: 'View organization license policy',
  includeOutputFlags: true,
  flags: {
    org: {
      type: 'string',
      default: '',
      description: 'Organization slug',
    },
  },
  handler: async ({ flags }) => {
    const { dryRun, json, markdown, org: orgFlag } = flags
    const outputKind = getOutputKind(json, markdown)
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)

    if (!runStandardValidations({
      requireOrg: orgSlug,
      requireAuth: true,
      dryRun,
      outputKind,
    })) {return}

    const result = await orgApi.licensePolicy(orgSlug)

    simpleOutput(result, outputKind, {
      text: data => {
        logger.log(colors.cyan('License Policy'))
        logger.log('')

        const anyData = data as any
        const allowed = anyData['allowed_licenses'] || anyData.allowed_licenses || []
        const denied = anyData['denied_licenses'] || anyData.denied_licenses || []

        if (allowed.length > 0) {
          logger.log(colors.green('Allowed licenses:'))
          for (const license of allowed) {
            logger.log(`  • ${license}`)
          }
        }

        if (denied.length > 0) {
          logger.log(colors.red('\nDenied licenses:'))
          for (const license of denied) {
            logger.log(`  • ${license}`)
          }
        }

        if (allowed.length === 0 && denied.length === 0) {
          logger.log('No license policies configured')
        }
      },
    })
  },
})

// Policy parent command
const cmdPolicy = buildParentCommand({
  name: 'policy',
  description: 'Manage organization policies',
  subcommands: {
    security: cmdSecurityPolicy,
    license: cmdLicensePolicy,
  },
})

// Export parent command with subcommands
export const cmdOrganization = buildParentCommand({
  name: 'organization',
  description: 'Manage Socket organizations',
  subcommands: {
    list: cmdList,
    dependencies: cmdDependencies,
    quota: cmdQuota,
    policy: cmdPolicy,
  },
  defaultSubcommand: 'list',
})

// Export individual commands for compatibility
export { cmdList as cmdOrganizationList }
export { cmdDependencies as cmdOrganizationDependencies }
export { cmdQuota as cmdOrganizationQuota }
export { cmdSecurityPolicy as cmdOrganizationPolicySecurity }
export { cmdLicensePolicy as cmdOrganizationPolicyLicense }