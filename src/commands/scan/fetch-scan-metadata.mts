import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchScanMetadataOptions = {
  sdkOptions?: SetupSdkOptions | undefined
}

export async function fetchScanMetadata(
  orgSlug: string,
  scanId: string,
  options?: FetchScanMetadataOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgFullScanMetadata'>['data']>> {
  const { sdkOptions } = {
    __proto__: null,
    ...options,
  } as FetchScanMetadataOptions

  const sockSdkCResult = await setupSdk(sdkOptions)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(sockSdk.getOrgFullScanMetadata(orgSlug, scanId), {
    desc: 'meta data for a full scan',
  })
}
