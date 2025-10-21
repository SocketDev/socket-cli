import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'
import type { CResult } from '../../types.mts'
import { handleApiCall } from '../../utils/socket/api.mjs'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

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
