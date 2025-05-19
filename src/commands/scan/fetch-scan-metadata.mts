import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchScanMetadata(
  orgSlug: string,
  scanId: string,
): Promise<CResult<SocketSdkReturnType<'getOrgFullScanMetadata'>['data']>> {
  const sockSdkResult = await setupSdk()
  if (!sockSdkResult.ok) {
    return sockSdkResult
  }
  const sockSdk = sockSdkResult.data

  return await handleApiCall(
    sockSdk.getOrgFullScanMetadata(orgSlug, scanId),
    'meta data for a full scan',
  )
}
