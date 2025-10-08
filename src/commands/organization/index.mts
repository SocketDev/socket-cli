/** @fileoverview Consolidated organization commands using DRY utilities */

import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { orgApi } from '../../utils/api-wrapper.mts'
import { buildCommand, buildParentCommand } from '../../utils/command-builder.mts'
import { runStandardValidations } from '../../utils/common-validations.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { commonColumns, simpleOutput } from '../../utils/simple-output.mts'


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
        rows: data => data as any[],
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
        rows: data => data.dependencies || [],
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

    const result = await orgApi.quota(orgSlug)

    simpleOutput(result, outputKind, {
      text: data => {
        logger.log(colors.cyan('Organization Quota'))
        logger.log('')

        const quotaData = [
          ['Seats', `${data.seats_used} / ${data.seats_total || 'Unlimited'}`],
          ['Repos', `${data.repos_used} / ${data.repos_total || 'Unlimited'}`],
          ['Scans', `${data.scans_used} / ${data.scans_total || 'Unlimited'}`],
        ]

        for (const [label, value] of quotaData) {
          logger.log(`${label}: ${value}`)
        }

        if (data.seats_total && data.seats_used >= data.seats_total * 0.9) {
          logger.warn('\n⚠️  Approaching seat limit!')
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

        if (data.rules && data.rules.length > 0) {
          for (const rule of data.rules) {
            logger.log(`• ${rule.name}: ${rule.enabled ? colors.green('Enabled') : colors.red('Disabled')}`)
            if (rule.severity) {
              logger.log(`  Severity: ${rule.severity}`)
            }
          }
        } else {
          logger.log('No security policies configured')
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

        const allowed = data.allowed_licenses || []
        const denied = data.denied_licenses || []

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