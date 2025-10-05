/** @fileoverview Scan metadata API fetcher for Socket CLI. Retrieves scan configuration metadata from Socket API including supported file types and scan parameters. */

import { withSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchScanMetadataOptions = BaseFetchOptions

export async function fetchScanMetadata(
  orgSlug: string,
  scanId: string,
  options?: FetchScanMetadataOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgFullScanMetadata'>['data']>> {
  return await withSdk(
    sdk => sdk.getOrgFullScanMetadata(orgSlug, scanId),
    'meta data for a full scan',
    options,
  )
}
