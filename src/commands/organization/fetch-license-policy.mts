/** @fileoverview Organization license policy API fetcher for Socket CLI. Retrieves license policy configuration from Socket API including allowed and denied license lists for organization compliance. */

import { withSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchLicensePolicyOptions = BaseFetchOptions

export async function fetchLicensePolicy(
  orgSlug: string,
  options?: FetchLicensePolicyOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgLicensePolicy'>['data']>> {
  return await withSdk(
    sdk => sdk.getOrgLicensePolicy(orgSlug),
    'organization license policy',
    options,
  )
}
