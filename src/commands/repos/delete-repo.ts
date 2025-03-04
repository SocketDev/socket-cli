import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

export async function deleteRepo(
  orgSlug: string,
  repoName: string
): Promise<void> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await deleteRepoWithToken(orgSlug, repoName, apiToken)
}

async function deleteRepoWithToken(
  orgSlug: string,
  repoName: string,
  apiToken: string
): Promise<void> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Deleting repository...')

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.deleteOrgRepo(orgSlug, repoName),
    'deleting repository'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('deleteOrgRepo', result, spinner)
    return
  }

  spinner.successAndStop('Repository deleted successfully')
}
