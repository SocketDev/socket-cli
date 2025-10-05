/** @fileoverview Organization quota API fetcher for Socket CLI. Retrieves organization quota limits and current usage from Socket API. Returns quota data for API calls, scans, and plan-specific limits. */

import { withSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchQuotaOptions = BaseFetchOptions

export async function fetchQuota(
  options?: FetchQuotaOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getQuota'>['data']>> {
  return await withSdk(sdk => sdk.getQuota(), 'token quota', options)
}
