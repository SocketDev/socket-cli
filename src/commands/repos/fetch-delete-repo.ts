import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDeleteRepo(
  orgSlug: string,
  repoName: string
): Promise<SocketSdkReturnType<'deleteOrgRepo'>['data'] | undefined> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  return await fetchDeleteRepoWithToken(orgSlug, repoName, apiToken)
}

async function fetchDeleteRepoWithToken(
  orgSlug: string,
  repoName: string,
  apiToken: string
): Promise<SocketSdkReturnType<'deleteOrgRepo'>['data'] | undefined> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  const socketSdk = await setupSdk(apiToken)

  spinner.start('Sending request to delete a repository...')

  const result = await handleApiCall(
    socketSdk.deleteOrgRepo(orgSlug, repoName),
    'deleting repository'
  )

  spinner.successAndStop('Received response requesting to delete a repository.')

  if (!result.success) {
    handleUnsuccessfulApiResponse('deleteOrgRepo', result)
    return
  }

  return result.data
}
