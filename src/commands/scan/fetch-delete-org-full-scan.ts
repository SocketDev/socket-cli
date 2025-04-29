import constants from '../../constants'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { CResult } from '../../types'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDeleteOrgFullScan(
  orgSlug: string,
  scanId: string
): Promise<CResult<SocketSdkReturnType<'deleteOrgFullScan'>['data']>> {
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
    return handleFailedApiResponse('deleteOrgFullScan', result)
  }

  return { ok: true, data: result.data }
}
