import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchOrgAnalyticsData(
  time: number,
): Promise<CResult<SocketSdkReturnType<'getOrgAnalytics'>['data']>> {
  const sockSdkResult = await setupSdk()
  if (!sockSdkResult.ok) {
    return sockSdkResult
  }
  const sockSdk = sockSdkResult.data

  return await handleApiCall(
    sockSdk.getOrgAnalytics(time.toString()),
    'analytics data',
  )
}
