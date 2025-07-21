import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchLicensePolicyOptions = {
  sdkOptions?: SetupSdkOptions | undefined
}

export async function fetchLicensePolicy(
  orgSlug: string,
  options?: FetchLicensePolicyOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgLicensePolicy'>['data']>> {
  const { sdkOptions } = {
    __proto__: null,
    ...options,
  } as FetchLicensePolicyOptions

  const sockSdkCResult = await setupSdk(sdkOptions)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(sockSdk.getOrgLicensePolicy(orgSlug), {
    desc: 'organization license policy',
  })
}
