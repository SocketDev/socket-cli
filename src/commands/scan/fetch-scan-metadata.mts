import constants from '../../constants.mts'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchScanMetadata(
  orgSlug: string,
  scanId: string
): Promise<CResult<SocketSdkReturnType<'getOrgFullScanMetadata'>['data']>> {
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching meta data for a full scan...')

  const result = await handleApiCall(
    sockSdk.getOrgFullScanMetadata(orgSlug, scanId),
    'Listing scans'
  )

  spinner.successAndStop('Received response for scan meta data.')

  if (!result.success) {
    return handleFailedApiResponse('getOrgFullScanMetadata', result)
  }

  return { ok: true, data: result.data }
}
