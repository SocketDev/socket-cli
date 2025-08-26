import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type RepoAnalyticsDataOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchRepoAnalyticsData(
  repo: string,
  time: number,
  options?: RepoAnalyticsDataOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getRepoAnalytics'>['data']>> {
  const { sdkOpts } = {
    __proto__: null,
    ...options,
  } as RepoAnalyticsDataOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(sockSdk.getRepoAnalytics(repo, time.toString()), {
    desc: 'analytics data',
  })
}
