import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

export async function deleteRepo(
  orgSlug: string,
  repoName: string,
  apiToken: string
): Promise<void> {
  const spinner = new Spinner()

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
