// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

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
  const spinnerText = 'Listing repositories... \n'
  const spinner = new Spinner({ text: spinnerText }).start()

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

  const options = {
    columns: [
      { field: 'id', name: colors.magenta('ID') },
      { field: 'name', name: colors.magenta('Name') },
      { field: 'visibility', name: colors.magenta('Visibility') },
      { field: 'default_branch', name: colors.magenta('Default branch') },
      { field: 'archived', name: colors.magenta('Archived') }
    ]
  }

  spinner.stop(chalkTable(options, result.data.results))
}
