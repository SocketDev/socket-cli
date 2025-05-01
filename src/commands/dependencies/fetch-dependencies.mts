import constants from '../../constants.mts'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDependencies({
  limit,
  offset
}: {
  limit: number
  offset: number
}): Promise<CResult<SocketSdkReturnType<'searchDependencies'>['data']>> {
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
    return handleFailedApiResponse('searchDependencies', result)
  }

  return { ok: true, data: result.data }
}
