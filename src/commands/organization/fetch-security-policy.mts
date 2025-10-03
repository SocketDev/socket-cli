/** @fileoverview Organization security policy API fetcher for Socket CLI. Retrieves security policy settings from Socket API including alert thresholds, issue actions, and scanning configurations for organization. */

import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

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
