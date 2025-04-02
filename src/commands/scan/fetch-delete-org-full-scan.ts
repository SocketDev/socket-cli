import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDeleteOrgFullScan(
  orgSlug: string,
  scanId: string
): Promise<SocketSdkReturnType<'deleteOrgFullScan'>['data'] | void> {
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Requesting the scan to be deleted...')

  const result = await handleApiCall(
    sockSdk.deleteOrgFullScan(orgSlug, scanId),
    'Deleting scan'
  )

  spinner.successAndStop('Received response for deleting a scan.')

  if (!result.success) {
    handleUnsuccessfulApiResponse('deleteOrgFullScan', result)
  }

  return result.data
}
