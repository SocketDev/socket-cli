import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDependencies({
  limit,
  offset,
}: {
  limit: number
  offset: number
}): Promise<CResult<SocketSdkReturnType<'searchDependencies'>['data']>> {
  const sockSdkCResult = await setupSdk()
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(
    sockSdk.searchDependencies({ limit, offset }),
    'organization dependencies',
  )
}
