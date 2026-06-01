import { handleApiCall } from '../../util/socket/api.mjs'
import { setupSdk } from '../../util/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../util/socket/sdk.mjs'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk-stable'

type FetchOrgAnalyticsDataOptions = {
  commandPath?: string | undefined
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchOrgAnalyticsData(
  time: number,
  options?: FetchOrgAnalyticsDataOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgAnalytics'>['data']>> {
  const { commandPath, sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchOrgAnalyticsDataOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall<'getOrgAnalytics'>(
    sockSdk.getOrgAnalytics(time.toString()),
    {
      commandPath,
      description: 'analytics data',
    },
  )
}
