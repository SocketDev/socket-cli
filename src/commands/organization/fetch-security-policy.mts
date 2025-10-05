/** @fileoverview Organization security policy API fetcher for Socket CLI. Retrieves security policy settings from Socket API including alert thresholds, issue actions, and scanning configurations for organization. */

import { withSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchSecurityPolicyOptions = BaseFetchOptions

export async function fetchSecurityPolicy(
  orgSlug: string,
  options?: FetchSecurityPolicyOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']>> {
  return await withSdk(
    sdk => sdk.getOrgSecurityPolicy(orgSlug),
    'organization security policy',
    options,
  )
}
