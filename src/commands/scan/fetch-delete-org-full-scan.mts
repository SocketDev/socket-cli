import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDeleteOrgFullScan(
  orgSlug: string,
  scanId: string
): Promise<CResult<SocketSdkReturnType<'deleteOrgFullScan'>['data']>> {
  const sockSdk = await setupSdk()

  return await handleApiCall(
    sockSdk.deleteOrgFullScan(orgSlug, scanId),
    'to delete a scan'
  )
}
