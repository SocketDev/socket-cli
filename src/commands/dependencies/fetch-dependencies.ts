import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDependencies({
  limit,
  offset
}: {
  limit: number
  offset: number
}): Promise<SocketSdkReturnType<'searchDependencies'>['data'] | undefined> {
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching organization dependencies...')

  const result = await handleApiCall(
    sockSdk.searchDependencies({ limit, offset }),
    'Searching dependencies'
  )

  spinner.successAndStop('Received organization dependencies response.')

  if (!result.success) {
    handleUnsuccessfulApiResponse('searchDependencies', result)
  }

  return result.data
}
