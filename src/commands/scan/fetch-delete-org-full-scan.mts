import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchDeleteOrgFullScanOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchDeleteOrgFullScan(
  orgSlug: string,
  scanId: string,
  options?: FetchDeleteOrgFullScanOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'deleteOrgFullScan'>['data']>> {
  const { sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchDeleteOrgFullScanOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(sockSdk.deleteOrgFullScan(orgSlug, scanId), {
    description: 'to delete a scan',
  })
}
