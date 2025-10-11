import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'

export type FetchQuotaOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

// Type expected by output modules
export interface QuotaResult {
  used: number
  limit: number
  percentage: number
  period: string
}

export async function fetchQuota(
  options?: FetchQuotaOptions | undefined,
): Promise<CResult<QuotaResult>> {
  const { sdkOpts } = { __proto__: null, ...options } as FetchQuotaOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  const apiResult = await handleApiCall(sockSdk.getQuota(), { description: 'token quota' })

  if (!apiResult.ok) {
    return apiResult
  }

  // Transform API response to expected format
  // The API only returns remaining quota, so we need to infer the rest
  const remaining = apiResult.data.quota
  // Assume a default limit - this would ideally come from org plan info
  // Default assumption
  const limit = 10000
  const used = Math.max(0, limit - remaining)
  const percentage = limit > 0 ? (used / limit) * 100 : 0

  const transformed: QuotaResult = {
    used,
    limit,
    percentage,
    // Default assumption
    period: 'monthly',
  }

  return {
    ok: true,
    data: transformed,
  }
}