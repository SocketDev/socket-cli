/** @fileoverview Organization quota API fetcher for Socket CLI. Retrieves organization quota limits and current usage from Socket API. Returns quota data for API calls, scans, and plan-specific limits. */

import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchQuotaOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchQuota(
  options?: FetchQuotaOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getQuota'>['data']>> {
  const { sdkOpts } = { __proto__: null, ...options } as FetchQuotaOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(sockSdk.getQuota(), { description: 'token quota' })
}
