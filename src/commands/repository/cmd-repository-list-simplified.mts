/** @fileoverview Simplified repository list command demonstrating DRY principles */

import { buildCommand } from '../../utils/command-builder.mts'
import { repoApi } from '../../utils/api-wrapper.mts'
import { outputPaginatedList, commonColumns } from '../../utils/simple-output.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { hasDefaultApiToken } from '../../utils/sdk.mts'
import { logger } from '@socketsecurity/registry/lib/logger'
import constants from '../../constants.mts'
import colors from 'yoctocolors-cjs'

export const cmdRepositoryListSimplified = buildCommand({
  name: 'list',
  description: 'List repositories in an organization',
  includeOutputFlags: true,
  flags: {
    all: {
      type: 'boolean',
      default: false,
      description: 'Fetch the entire list (ignores pagination)',
    },
    direction: {
      type: 'string',
      default: 'desc',
      description: 'Direction option (asc or desc)',
    },
    org: {
      type: 'string',
      default: '',
      description: 'Override the organization slug',
    },
    perPage: {
      type: 'number',
      default: 30,
      description: 'Number of results per page',
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
      description: 'Sorting option',
      shortFlag: 's',
    },
  },
  examples: [
    { command: '', description: 'List repositories' },
    { command: '--json', description: 'Output as JSON' },
    { command: '--all', description: 'List all repositories' },
  ],
  handler: async ({ flags }) => {
    const {
      all,
      direction = 'desc',
      dryRun,
      json,
      markdown,
      org: orgFlag,
      page,
      perPage,
      sort,
    } = flags

    // Determine organization
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)
    const outputKind = getOutputKind(json, markdown)

    // Validation
    const wasValidInput = checkCommandInput(
      outputKind,
      {
        nook: true,
        test: !!orgSlug,
        message: 'Organization slug required',
        fail: 'missing',
      },
      {
        nook: true,
        test: direction === 'asc' || direction === 'desc',
        message: 'Direction must be "asc" or "desc"',
        fail: 'bad',
      },
    )
    if (!wasValidInput) return

    // Dry run check
    if (dryRun) {
      logger.log(constants.DRY_RUN_BAILING_NOW)
      return
    }

    // Auth check
    if (!hasDefaultApiToken()) {
      logger.error('This command requires a Socket API token')
      logger.log('Run `socket login` first')
      process.exitCode = 1
      return
    }

    // Fetch data
    const actualPerPage = all ? Infinity : perPage
    const result = await repoApi.list(orgSlug, {
      sort,
      direction,
      per_page: String(actualPerPage),
      page: String(page),
    })

    // Calculate next page
    const nextPage = result.ok && result.data.length === perPage ? page + 1 : null

    // Output
    outputPaginatedList(result, outputKind, {
      page,
      perPage: actualPerPage,
      nextPage,
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
      emptyMessage: 'No repositories found',
    })
  },
})