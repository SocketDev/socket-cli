import { handleApiCall } from '../../utils/api.mts'
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

  return await handleApiCall(
    sockSdk.searchDependencies({ limit, offset }),
    'Requesting organization dependencies from API...',
    'Received response from API (requested organization dependencies).',
    'Error fetching organization dependencies',
    'searchDependencies'
  )
}
