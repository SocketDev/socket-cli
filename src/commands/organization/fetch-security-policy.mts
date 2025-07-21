import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchSecurityPolicyOptions = {
  sdkOptions?: SetupSdkOptions | undefined
}

export async function fetchSecurityPolicy(
  orgSlug: string,
  options?: FetchSecurityPolicyOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']>> {
  const { sdkOptions } = {
    __proto__: null,
    ...options,
  } as FetchSecurityPolicyOptions

  const sockSdkCResult = await setupSdk(sdkOptions)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(sockSdk.getOrgSecurityPolicy(orgSlug), {
    desc: 'organization security policy',
  })
}
