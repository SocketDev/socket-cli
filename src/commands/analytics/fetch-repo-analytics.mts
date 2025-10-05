/** @fileoverview Repository analytics fetching for Socket CLI. Retrieves repository-specific security metrics from the Socket API including alert counts and dependency analysis. */

import { withSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type RepoAnalyticsDataOptions = BaseFetchOptions

export async function fetchRepoAnalyticsData(
  repo: string,
  time: number,
  options?: RepoAnalyticsDataOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getRepoAnalytics'>['data']>> {
  return await withSdk(
    sdk => sdk.getRepoAnalytics(repo, time.toString()),
    'analytics data',
    options,
  )
}
