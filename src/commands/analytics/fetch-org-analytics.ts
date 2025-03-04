import { logger } from '@socketsecurity/registry/lib/logger'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { Spinner } from '@socketsecurity/registry/lib/spinner'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchOrgAnalyticsData(
  time: number,
  spinner: Spinner,
  apiToken: string
): Promise<SocketSdkReturnType<'getOrgAnalytics'>['data'] | undefined> {
  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getOrgAnalytics(time.toString()),
    'fetching analytics data'
  )

  if (result.success === false) {
    handleUnsuccessfulApiResponse('getOrgAnalytics', result)
    return undefined
  }

  spinner.stop()

  if (!result.data.length) {
    logger.log('No analytics data is available for this organization yet.')
    return undefined
  }

  return result.data
}
