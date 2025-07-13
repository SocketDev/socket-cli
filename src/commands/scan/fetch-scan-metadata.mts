import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchScanMetadata(
  orgSlug: string,
  scanId: string,
): Promise<CResult<SocketSdkReturnType<'getOrgFullScanMetadata'>['data']>> {
  const sockSdkCResult = await setupSdk()
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(
    sockSdk.getOrgFullScanMetadata(orgSlug, scanId),
    'meta data for a full scan',
  )
}
