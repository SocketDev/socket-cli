import { handleApiCall } from '../../util/socket/api.mjs'
import { setupSdk } from '../../util/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../util/socket/sdk.mjs'
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

  return await handleApiCall<'getQuota'>(sockSdk.getQuota(), {
    description: 'token quota',
  })
}
