import constants from '../../constants'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { CResult } from '../../types'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchRepoAnalyticsData(
  repo: string,
  time: number
): Promise<CResult<SocketSdkReturnType<'getRepoAnalytics'>['data']>> {
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start(`Requesting analytics data from API...`)

  const result = await handleApiCall(
    sockSdk.getRepoAnalytics(repo, time.toString()),
    'fetching analytics data'
  )

  spinner.successAndStop(`Received API response.`)

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
