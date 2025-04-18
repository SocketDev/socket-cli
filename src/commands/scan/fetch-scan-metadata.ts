import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchScanMetadata(
  orgSlug: string,
  scanId: string
): Promise<SocketSdkReturnType<'getOrgFullScanMetadata'>['data'] | void> {
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
    handleUnsuccessfulApiResponse('getOrgFullScanMetadata', result)
  }

  return result.data
}
