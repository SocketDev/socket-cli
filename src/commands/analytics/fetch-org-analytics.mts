/** @fileoverview Organization analytics fetching for Socket CLI. Retrieves organization-wide security metrics from the Socket API including alert counts and issue summaries. */

import { withSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchOrgAnalyticsDataOptions = BaseFetchOptions

export async function fetchOrgAnalyticsData(
  time: number,
  options?: FetchOrgAnalyticsDataOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgAnalytics'>['data']>> {
  return await withSdk(
    sdk => sdk.getOrgAnalytics(time.toString()),
    'analytics data',
    options,
  )
}
