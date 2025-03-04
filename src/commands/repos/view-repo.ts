// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

export async function viewRepo(
  orgSlug: string,
  repoName: string,
  outputKind: 'json' | 'markdown' | 'print'
): Promise<void> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }
  await viewRepoWithToken(orgSlug, repoName, apiToken, outputKind)
}

async function viewRepoWithToken(
  orgSlug: string,
  repoName: string,
  apiToken: string,
  outputKind: 'json' | 'markdown' | 'print'
): Promise<void> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching repository data...')

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getOrgRepo(orgSlug, repoName),
    'fetching repository'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgRepo', result)
    return
  }

  spinner.stop('Fetched repository data.')

  if (outputKind === 'json') {
    const {
      archived,
      created_at,
      default_branch,
      homepage,
      id,
      name,
      visibility
    } = result.data
    logger.log(
      JSON.stringify(
        {
          id,
          name,
          visibility,
          default_branch,
          homepage,
          archived,
          created_at
        },
        null,
        2
      )
    )
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

  logger.log(chalkTable(options, [result.data]))
}
