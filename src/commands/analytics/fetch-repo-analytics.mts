import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function fetchRepoAnalyticsData(
  repo: string,
  time: number,
): Promise<CResult<SocketSdkSuccessResult<'getRepoAnalytics'>['data']>> {
  const sockSdkCResult = await setupSdk()
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(
    sockSdk.getRepoAnalytics(repo, time.toString()),
    'analytics data',
  )
}
