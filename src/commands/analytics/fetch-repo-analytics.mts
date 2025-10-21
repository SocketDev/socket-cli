import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'
import type { CResult } from '../../types.mts'
import { handleApiCall } from '../../utils/socket/api.mjs'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

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
    description: 'analytics data',
  })
}
