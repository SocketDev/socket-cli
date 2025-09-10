import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchOrgAnalyticsDataOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchOrgAnalyticsData(
  time: number,
  options?: FetchOrgAnalyticsDataOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgAnalytics'>['data']>> {
  const { sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchOrgAnalyticsDataOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(sockSdk.getOrgAnalytics(time.toString()), {
    description: 'analytics data',
  })
}
