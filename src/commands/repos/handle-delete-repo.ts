import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

export async function handleDeleteRepo(
  orgSlug: string,
  repoName: string
): Promise<void> {
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Deleting repository...')

  const result = await handleApiCall(
    sockSdk.deleteOrgRepo(orgSlug, repoName),
    'deleting repository'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('deleteOrgRepo', result)
  }

  spinner.successAndStop('Repository deleted successfully')
}
