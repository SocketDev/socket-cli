import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchViewRepo(
  orgSlug: string,
  repoName: string
): Promise<SocketSdkReturnType<'getOrgRepo'>['data'] | undefined> {
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching repository data...')

  const result = await handleApiCall(
    sockSdk.getOrgRepo(orgSlug, repoName),
    'fetching repository'
  )

  spinner.successAndStop('Received response while fetched repository data.')

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgRepo', result)
  }

  return result.data
}
