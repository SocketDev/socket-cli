import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchQuota(): Promise<
  CResult<SocketSdkReturnType<'getQuota'>['data']>
> {
  const sockSdk = await setupSdk()

  return await handleApiCall(
    sockSdk.getQuota(),
    'Requesting token quota from API...',
    'Received API response (requested token quota).',
    'Error fetching token quota',
    'getQuota'
  )
}
