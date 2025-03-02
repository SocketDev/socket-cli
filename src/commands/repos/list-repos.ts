// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

export async function listRepos({
  apiToken,
  direction,
  orgSlug,
  outputJson,
  outputMarkdown,
  page,
  per_page,
  sort
}: {
  outputJson: boolean
  outputMarkdown: boolean
  orgSlug: string
  sort: string
  direction: string
  per_page: number
  page: number
  apiToken: string
}): Promise<void> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Listing repositories...')

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getOrgRepoList(orgSlug, {
      outputJson,
      outputMarkdown,
      orgSlug,
      sort,
      direction,
      per_page,
      page
    }),
    'listing repositories'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgRepoList', result, spinner)
    return
  }

  spinner.stop()

  if (outputJson) {
    const data = result.data.results.map(o => ({
      id: o.id,
      name: o.name,
      visibility: o.visibility,
      defaultBranch: o.default_branch,
      archived: o.archived
    }))
    logger.log(JSON.stringify(data, null, 2))
    return
  }

  const options = {
    columns: [
      { field: 'id', name: colors.magenta('ID') },
      { field: 'name', name: colors.magenta('Name') },
      { field: 'visibility', name: colors.magenta('Visibility') },
      { field: 'default_branch', name: colors.magenta('Default branch') },
      { field: 'archived', name: colors.magenta('Archived') }
    ]
  }

  logger.log(chalkTable(options, result.data.results))
}
