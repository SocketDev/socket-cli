import { handleApiCall } from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchScanMetadataOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchScanMetadata(
  orgSlug: string,
  scanId: string,
  options?: FetchScanMetadataOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgFullScanMetadata'>['data']>> {
  const { sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchScanMetadataOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(sockSdk.getFullScanMetadata(orgSlug, scanId), {
    description: 'meta data for a full scan',
  })
}
