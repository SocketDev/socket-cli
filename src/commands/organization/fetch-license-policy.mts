/** @fileoverview Organization license policy API fetcher for Socket CLI. Retrieves license policy configuration from Socket API including allowed and denied license lists for organization compliance. */

import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchLicensePolicyOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchLicensePolicy(
  orgSlug: string,
  options?: FetchLicensePolicyOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgLicensePolicy'>['data']>> {
  const { sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchLicensePolicyOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(sockSdk.getOrgLicensePolicy(orgSlug), {
    description: 'organization license policy',
  })
}
