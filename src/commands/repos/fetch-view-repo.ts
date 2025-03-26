import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchViewRepo(
  orgSlug: string,
  repoName: string
): Promise<SocketSdkReturnType<'getOrgRepo'>['data'] | undefined> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }
  return await fetchViewRepoWithToken(orgSlug, repoName, apiToken)
}

async function fetchViewRepoWithToken(
  orgSlug: string,
  repoName: string,
  apiToken: string
): Promise<SocketSdkReturnType<'getOrgRepo'>['data'] | undefined> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  const sockSdk = await setupSdk(apiToken)

  spinner.start('Fetching repository data...')

  const result = await handleApiCall(
    sockSdk.getOrgRepo(orgSlug, repoName),
    'fetching repository'
  )

  spinner.successAndStop('Received response while fetched repository data.')

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgRepo', result)
    return
  }

  return result.data
}
