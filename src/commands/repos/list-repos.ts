// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

export async function listRepos({
  direction,
  orgSlug,
  outputKind,
  page,
  per_page,
  sort
}: {
  direction: string
  orgSlug: string
  outputKind: 'json' | 'markdown' | 'print'
  page: number
  per_page: number
  sort: string
}): Promise<void> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await listReposWithToken({
    apiToken,
    direction,
    orgSlug,
    outputKind,
    page,
    per_page,
    sort
  })
}

async function listReposWithToken({
  apiToken,
  direction,
  orgSlug,
  outputKind,
  page,
  per_page,
  sort
}: {
  apiToken: string
  direction: string
  orgSlug: string
  outputKind: 'json' | 'markdown' | 'print'
  page: number
  per_page: number
  sort: string
}): Promise<void> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching list of repositories...')

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getOrgRepoList(orgSlug, {
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

  spinner.stop('Fetch complete.')

  if (outputKind === 'json') {
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
