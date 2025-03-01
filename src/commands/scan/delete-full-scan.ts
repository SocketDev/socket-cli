import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

export async function deleteOrgFullScan(
  orgSlug: string,
  fullScanId: string,
  apiToken: string
): Promise<void> {
  const spinner = new Spinner()

  spinner.start('Deleting scan...')

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.deleteOrgFullScan(orgSlug, fullScanId),
    'Deleting scan'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('deleteOrgFullScan', result, spinner)
    return
  }
  spinner.successAndStop('Scan deleted successfully')
}
