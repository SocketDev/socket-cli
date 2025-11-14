import { handleApiCall } from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type RepoAnalyticsDataOptions = {
  commandPath?: string | undefined
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchRepoAnalyticsData(
  repo: string,
  time: number,
  options?: RepoAnalyticsDataOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getRepoAnalytics'>['data']>> {
  const { commandPath, sdkOpts } = {
    __proto__: null,
    ...options,
  } as RepoAnalyticsDataOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall<'getRepoAnalytics'>(
    sockSdk.getRepoAnalytics(repo, time.toString()),
    {
      commandPath,
      description: 'analytics data',
    },
  )
}
