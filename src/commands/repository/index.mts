/** @fileoverview Consolidated repository commands using DRY utilities */

import { buildCommand, buildParentCommand } from '../../utils/command-builder.mts'
import { repoApi } from '../../utils/api-wrapper.mts'
import { simpleOutput, outputPaginatedList, commonColumns } from '../../utils/simple-output.mts'
import { runStandardValidations } from '../../utils/common-validations.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { logger } from '@socketsecurity/registry/lib/logger'
import colors from 'yoctocolors-cjs'

// List repositories
const cmdList = buildCommand({
  name: 'list',
  description: 'List repositories in an organization',
  includeOutputFlags: true,
  flags: {
    all: {
      type: 'boolean',
      default: false,
      description: 'Fetch all repositories',
    },
    direction: {
      type: 'string',
      default: 'desc',
      description: 'Sort direction (asc/desc)',
    },
    org: {
      type: 'string',
      default: '',
      description: 'Organization slug',
    },
    perPage: {
      type: 'number',
      default: 30,
      description: 'Results per page',
      shortFlag: 'pp',
    },
    page: {
      type: 'number',
      default: 1,
      description: 'Page number',
      shortFlag: 'p',
    },
    sort: {
      type: 'string',
      default: 'created_at',
      description: 'Sort field',
      shortFlag: 's',
    },
  },
  handler: async ({ flags }) => {
    const { all, direction, dryRun, json, markdown, org: orgFlag, page, perPage, sort } = flags
    const outputKind = getOutputKind(json, markdown)
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)

    if (!runStandardValidations({
      requireOrg: orgSlug,
      requireAuth: true,
      dryRun,
      outputKind,
    })) return

    const result = await repoApi.list(orgSlug, {
      sort,
      direction,
      per_page: String(all ? 10000 : perPage),
      page: String(page),
    })

    outputPaginatedList(result, outputKind, {
      page,
      perPage: all ? Infinity : perPage,
      nextPage: result.ok && result.data.length === perPage ? page + 1 : null,
      sort,
      direction,
    }, {
      columns: [
        commonColumns.id,
        commonColumns.name,
        { field: 'visibility', name: colors.magenta('Visibility') },
        { field: 'default_branch', name: colors.magenta('Default Branch') },
        commonColumns.boolean('archived', 'Archived'),
      ],
      getRows: data => data as any[],
    })
  },
})

// Create repository
const cmdCreate = buildCommand({
  name: 'create',
  description: 'Create a new repository',
  args: '<repo-name>',
  includeOutputFlags: true,
  flags: {
    org: {
      type: 'string',
      default: '',
      description: 'Organization slug',
    },
    branch: {
      type: 'string',
      default: 'main',
      description: 'Default branch name',
    },
    description: {
      type: 'string',
      default: '',
      description: 'Repository description',
    },
    visibility: {
      type: 'string',
      default: 'private',
      description: 'Repository visibility (public/private)',
    },
  },
  handler: async ({ input, flags }) => {
    const repoName = input[0]
    if (!repoName) {
      logger.error('Repository name is required')
      process.exitCode = 1
      return
    }

    const { org: orgFlag, branch, description, visibility, dryRun, json, markdown } = flags
    const outputKind = getOutputKind(json, markdown)
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)

    if (!runStandardValidations({
      requireOrg: orgSlug,
      requireAuth: true,
      dryRun,
      outputKind,
    })) return

    const result = await repoApi.create(orgSlug, {
      name: repoName,
      default_branch: branch,
      description,
      visibility,
      homepage: '',
    })

    simpleOutput(result, outputKind, {
      title: 'Repository created',
      text: data => {
        logger.success(`Created repository: ${data.name}`)
        logger.log(`URL: ${data.html_url}`)
      },
    })
  },
})

// Delete repository
const cmdDelete = buildCommand({
  name: 'del',
  description: 'Delete a repository',
  args: '<repo-name>',
  flags: {
    org: {
      type: 'string',
      default: '',
      description: 'Organization slug',
    },
    force: {
      type: 'boolean',
      default: false,
      description: 'Skip confirmation',
      shortFlag: 'f',
    },
  },
  handler: async ({ input, flags }) => {
    const repoName = input[0]
    if (!repoName) {
      logger.error('Repository name is required')
      process.exitCode = 1
      return
    }

    const { org: orgFlag, force, dryRun } = flags
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)

    if (!runStandardValidations({
      requireOrg: orgSlug,
      requireAuth: true,
      dryRun,
      outputKind: 'text',
    })) return

    if (!force) {
      logger.warn(`This will permanently delete repository: ${repoName}`)
      logger.log('Use --force to confirm')
      return
    }

    const result = await repoApi.delete(orgSlug, repoName)

    if (result.ok) {
      logger.success(`Deleted repository: ${repoName}`)
    } else {
      logger.error(`Failed to delete repository: ${result.message}`)
      process.exitCode = 1
    }
  },
})

// View repository
const cmdView = buildCommand({
  name: 'view',
  description: 'View repository details',
  args: '<repo-name>',
  includeOutputFlags: true,
  flags: {
    org: {
      type: 'string',
      default: '',
      description: 'Organization slug',
    },
  },
  handler: async ({ input, flags }) => {
    const repoName = input[0]
    if (!repoName) {
      logger.error('Repository name is required')
      process.exitCode = 1
      return
    }

    const { org: orgFlag, dryRun, json, markdown } = flags
    const outputKind = getOutputKind(json, markdown)
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)

    if (!runStandardValidations({
      requireOrg: orgSlug,
      requireAuth: true,
      dryRun,
      outputKind,
    })) return

    const result = await repoApi.view(orgSlug, repoName)

    simpleOutput(result, outputKind, {
      text: data => {
        logger.log(colors.cyan('Repository Details'))
        logger.log(`Name: ${data.name}`)
        logger.log(`Description: ${data.description || 'N/A'}`)
        logger.log(`Visibility: ${data.visibility}`)
        logger.log(`Default Branch: ${data.default_branch}`)
        logger.log(`Created: ${new Date(data.created_at).toLocaleDateString()}`)
        logger.log(`URL: ${data.html_url}`)
      },
    })
  },
})

// Update repository
const cmdUpdate = buildCommand({
  name: 'update',
  description: 'Update repository settings',
  args: '<repo-name>',
  includeOutputFlags: true,
  flags: {
    org: {
      type: 'string',
      default: '',
      description: 'Organization slug',
    },
    branch: {
      type: 'string',
      description: 'Default branch name',
    },
    description: {
      type: 'string',
      description: 'Repository description',
    },
    visibility: {
      type: 'string',
      description: 'Repository visibility (public/private)',
    },
  },
  handler: async ({ input, flags }) => {
    const repoName = input[0]
    if (!repoName) {
      logger.error('Repository name is required')
      process.exitCode = 1
      return
    }

    const { org: orgFlag, branch, description, visibility, dryRun, json, markdown } = flags
    const outputKind = getOutputKind(json, markdown)
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)

    const updates: any = {}
    if (branch) updates.default_branch = branch
    if (description !== undefined) updates.description = description
    if (visibility) updates.visibility = visibility

    if (Object.keys(updates).length === 0) {
      logger.error('No updates specified')
      logger.log('Use --branch, --description, or --visibility')
      process.exitCode = 1
      return
    }

    if (!runStandardValidations({
      requireOrg: orgSlug,
      requireAuth: true,
      dryRun,
      outputKind,
    })) return

    const result = await repoApi.update(orgSlug, repoName, updates)

    simpleOutput(result, outputKind, {
      title: 'Repository updated',
      text: data => {
        logger.success(`Updated repository: ${data.name}`)
      },
    })
  },
})

// Export parent command with subcommands
export const cmdRepository = buildParentCommand({
  name: 'repository',
  description: 'Manage Socket repositories',
  subcommands: {
    list: cmdList,
    create: cmdCreate,
    del: cmdDelete,
    view: cmdView,
    update: cmdUpdate,
  },
  defaultSubcommand: 'list',
})

// Export individual commands for compatibility
export { cmdList as cmdRepositoryList }
export { cmdCreate as cmdRepositoryCreate }
export { cmdDelete as cmdRepositoryDel }
export { cmdView as cmdRepositoryView }
export { cmdUpdate as cmdRepositoryUpdate }