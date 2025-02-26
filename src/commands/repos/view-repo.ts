// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

export async function viewRepo(
  orgSlug: string,
  repoName: string,
  apiToken: string
): Promise<void> {
  const spinnerText = 'Fetching repository... \n'
  const spinner = new Spinner({ text: spinnerText }).start()

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getOrgRepo(orgSlug, repoName),
    'fetching repository'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgRepo', result, spinner)
    return
  }

  const options = {
    columns: [
      { field: 'id', name: colors.magenta('ID') },
      { field: 'name', name: colors.magenta('Name') },
      { field: 'visibility', name: colors.magenta('Visibility') },
      { field: 'default_branch', name: colors.magenta('Default branch') },
      { field: 'homepage', name: colors.magenta('Homepage') },
      { field: 'archived', name: colors.magenta('Archived') },
      { field: 'created_at', name: colors.magenta('Created at') }
    ]
  }

  spinner.stop(chalkTable(options, [result.data]))
}
