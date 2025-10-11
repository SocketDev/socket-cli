/** @fileoverview Consolidated repository commands using DRY utilities */

// import colors from 'yoctocolors-cjs'

// import { logger } from '@socketsecurity/registry/lib/logger'

// import { repoApi } from '../../utils/api-wrapper.mts'
// import { buildCommand, buildParentCommand } from '../../utils/command-builder.mts'
// import { runStandardValidations } from '../../utils/common-validations.mts'
// import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
// import { getOutputKind } from '../../utils/get-output-kind.mts'
// import { commonColumns, outputPaginatedList, simpleOutput } from '../../utils/simple-output.mts'

// Use the original implementations that properly handle help and command delegation
import { cmdRepositoryCreate as cmdOriginalCreate } from './cmd-repository-create.mts'
import { cmdRepositoryDel as cmdOriginalDel } from './cmd-repository-del.mts'
import { cmdRepositoryList as cmdOriginalList } from './cmd-repository-list.mts'
import { cmdRepositoryUpdate as cmdOriginalUpdate } from './cmd-repository-update.mts'
import { cmdRepositoryView as cmdOriginalView } from './cmd-repository-view.mts'
import { cmdRepository as cmdOriginalRepository } from './cmd-repository.mts'



/*
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
    })) {return}

    const result = await repoApi.list(orgSlug, {
      sort,
      direction,
      per_page: String(all ? 10000 : perPage),
      page: String(page),
    })

    outputPaginatedList(result, outputKind, {
      page,
      perPage: all ? Infinity : perPage,
      nextPage: result.ok && (result.data as any).results?.length === perPage ? page + 1 : null,
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
      getRows: data => (data as any).results || [],
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
  handler: async ({ flags, input }) => {
    const repoName = input[0]
    if (!repoName) {
      logger.error('Repository name is required')
      process.exitCode = 1
      return
    }

    const { branch, description, dryRun, json, markdown, org: orgFlag, visibility } = flags
    const outputKind = getOutputKind(json, markdown)
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)

    if (!runStandardValidations({
      requireOrg: orgSlug,
      requireAuth: true,
      dryRun,
      outputKind,
    })) {return}

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
        logger.log(`URL: ${(data as any).html_url || 'N/A'}`)
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
  handler: async ({ flags, input }) => {
    const repoName = input[0]
    if (!repoName) {
      logger.error('Repository name is required')
      process.exitCode = 1
      return
    }

    const { dryRun, force, org: orgFlag } = flags
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)

    if (!runStandardValidations({
      requireOrg: orgSlug,
      requireAuth: true,
      dryRun,
      outputKind: 'text',
    })) {return}

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
  handler: async ({ flags, input }) => {
    const repoName = input[0]
    if (!repoName) {
      logger.error('Repository name is required')
      process.exitCode = 1
      return
    }

    const { dryRun, json, markdown, org: orgFlag } = flags
    const outputKind = getOutputKind(json, markdown)
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)

    if (!runStandardValidations({
      requireOrg: orgSlug,
      requireAuth: true,
      dryRun,
      outputKind,
    })) {return}

    const result = await repoApi.view(orgSlug, repoName)

    simpleOutput(result, outputKind, {
      text: data => {
        logger.log(colors.cyan('Repository Details'))
        logger.log(`Name: ${data.name}`)
        logger.log(`Description: ${data.description || 'N/A'}`)
        logger.log(`Visibility: ${data.visibility}`)
        logger.log(`Default Branch: ${data.default_branch}`)
        logger.log(`Created: ${new Date(data.created_at).toLocaleDateString()}`)
        logger.log(`URL: ${(data as any).html_url || 'N/A'}`)
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
  handler: async ({ flags, input }) => {
    const repoName = input[0]
    if (!repoName) {
      logger.error('Repository name is required')
      process.exitCode = 1
      return
    }

    const { branch, description, dryRun, json, markdown, org: orgFlag, visibility } = flags
    const outputKind = getOutputKind(json, markdown)
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)

    const updates: any = {}
    if (branch) {updates.default_branch = branch}
    if (description !== undefined) {updates.description = description}
    if (visibility) {updates.visibility = visibility}

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
    })) {return}

    const result = await repoApi.update(orgSlug, repoName, updates)

    simpleOutput(result, outputKind, {
      title: 'Repository updated',
      text: data => {
        logger.success(`Updated repository: ${data.name}`)
      },
    })
  },
})
*/

// Export parent command with subcommands
// export const cmdRepository = buildParentCommand({
//   name: 'repository',
//   description: 'Manage Socket repositories',
//   subcommands: {
//     list: cmdList,
//     create: cmdCreate,
//     del: cmdDelete,
//     view: cmdView,
//     update: cmdUpdate,
//   },
//   defaultSubcommand: 'list',
// })

// Export the original repository command which properly uses meowWithSubcommands
export const cmdRepository = cmdOriginalRepository

// Export individual commands for compatibility
export { cmdOriginalList as cmdRepositoryList }
export { cmdOriginalCreate as cmdRepositoryCreate }
export { cmdOriginalDel as cmdRepositoryDel }
export { cmdOriginalView as cmdRepositoryView }
export { cmdOriginalUpdate as cmdRepositoryUpdate }