import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchRepoAnalyticsData(
  repo: string,
  time: number
): Promise<CResult<SocketSdkReturnType<'getRepoAnalytics'>['data']>> {
  const sockSdk = await setupSdk()

  return await handleApiCall(
    sockSdk.getRepoAnalytics(repo, time.toString()),
    'Requesting analytics data from API...',
    'Received API response (requested analytics data).',
    'Error fetching analytics data',
    'getRepoAnalytics'
  )
}
