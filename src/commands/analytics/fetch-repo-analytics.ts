import { handleApiCall, handleFailedApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { CliJsonResult } from '../../types'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchRepoAnalyticsData(
  repo: string,
  time: number
): Promise<CliJsonResult<SocketSdkReturnType<'getRepoAnalytics'>['data']>> {
  const sockSdk = await setupSdk()
  const result = await handleApiCall(
    sockSdk.getRepoAnalytics(repo, time.toString()),
    'fetching analytics data'
  )

  if (result.success === false) {
    return handleFailedApiResponse('getRepoAnalytics', result)
  }

  if (!result.data.length) {
    return {
      ok: true,
      message: 'No analytics data is available for this repository yet.',
      data: []
    }
  }

  return {
    ok: true,
    data: result.data
  }
}
