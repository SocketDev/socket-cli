/** @fileoverview Scan deletion API fetcher for Socket CLI. Deletes organization scans via Socket API. Requires organization slug and scan identifier. Returns deletion confirmation. */

import { withSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchDeleteOrgFullScanOptions = BaseFetchOptions

export async function fetchDeleteOrgFullScan(
  orgSlug: string,
  scanId: string,
  options?: FetchDeleteOrgFullScanOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'deleteOrgFullScan'>['data']>> {
  return await withSdk(
    sdk => sdk.deleteOrgFullScan(orgSlug, scanId),
    'to delete a scan',
    options,
  )
}
