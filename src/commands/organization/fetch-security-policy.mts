import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'
import type { CResult } from '../../types.mts'
import { handleApiCall } from '../../utils/socket/api.mjs'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

export type FetchSecurityPolicyOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchSecurityPolicy(
  orgSlug: string,
  options?: FetchSecurityPolicyOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']>> {
  const { sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchSecurityPolicyOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(sockSdk.getOrgSecurityPolicy(orgSlug), {
    description: 'organization security policy',
  })
}
