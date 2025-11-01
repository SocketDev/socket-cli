/** @fileoverview Simplified repository list command demonstrating DRY principles */

import colors from 'yoctocolors-cjs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { DRY_RUN_BAILING_NOW } from '../../constants/cli.mts'
import { buildCommand } from '../../utils/command/builder.mts'
import { getOutputKind } from '../../utils/output/mode.mjs'
import { repoApi } from '../../utils/socket/api-wrapper.mjs'
import { determineOrgSlug } from '../../utils/socket/org-slug.mjs'
import { hasDefaultApiToken } from '../../utils/socket/sdk.mjs'
import {
  commonColumns,
  outputPaginatedList,
} from '../../utils/terminal/simple-output.mts'
import { checkCommandInput } from '../../utils/validation/check-input.mts'

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
    if (!wasValidInput) {
      return
    }

    // Dry run check
    if (dryRun) {
      getDefaultLogger().log(DRY_RUN_BAILING_NOW)
      return
    }

    // Auth check
    if (!hasDefaultApiToken()) {
      getDefaultLogger().error('This command requires a Socket API token')
      getDefaultLogger().log('Run `socket login` first')
      process.exitCode = 1
      return
    }

    // Fetch data
    const actualPerPage = all ? Number.POSITIVE_INFINITY : perPage
    const result = await repoApi.list(orgSlug, {
      sort,
      direction,
      per_page: String(actualPerPage),
      page: String(page),
    })

    // Calculate next page
    const nextPage =
      result.ok && result.data.results?.length === perPage ? page + 1 : null

    // Output
    outputPaginatedList(
      result,
      outputKind,
      {
        page,
        perPage: actualPerPage,
        nextPage,
        sort,
        direction,
      },
      {
        columns: [
          commonColumns.id,
          commonColumns.name,
          { field: 'visibility', name: colors.magenta('Visibility') },
          { field: 'default_branch', name: colors.magenta('Default Branch') },
          commonColumns.boolean('archived', 'Archived'),
        ],
        getRows: data => data.results as any[],
        emptyMessage: 'No repositories found',
      },
    )
  },
})

export default cmdRepositoryListSimplified
