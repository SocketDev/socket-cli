import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

export async function deleteRepo(
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

  if (result.success) {
    spinner.successAndStop('Repository deleted successfully')
  } else {
    handleUnsuccessfulApiResponse('deleteOrgRepo', result, spinner)
  }
}
