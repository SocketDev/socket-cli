import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDeleteOrgFullScan(
  orgSlug: string,
  scanId: string
): Promise<CResult<SocketSdkReturnType<'deleteOrgFullScan'>['data']>> {
  const sockSdkResult = await setupSdk()
  if (!sockSdkResult.ok) {
    return sockSdkResult
  }
  const sockSdk = sockSdkResult.data

  return await handleApiCall(
    sockSdk.deleteOrgFullScan(orgSlug, scanId),
    'to delete a scan'
  )
}
