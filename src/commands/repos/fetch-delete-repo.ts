import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDeleteRepo(
  orgSlug: string,
  repoName: string
): Promise<SocketSdkReturnType<'deleteOrgRepo'>['data'] | undefined> {
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Sending request to delete a repository...')

  const result = await handleApiCall(
    sockSdk.deleteOrgRepo(orgSlug, repoName),
    'deleting repository'
  )

  spinner.successAndStop('Received response requesting to delete a repository.')

  if (!result.success) {
    handleUnsuccessfulApiResponse('deleteOrgRepo', result)
    return
  }

  return result.data
}
