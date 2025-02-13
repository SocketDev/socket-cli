import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

export async function deleteOrgFullScan(
  orgSlug: string,
  fullScanId: string,
  apiToken: string
): Promise<void> {
  const spinnerText = 'Deleting scan...'
  const spinner = new Spinner({ text: spinnerText }).start()

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.deleteOrgFullScan(orgSlug, fullScanId),
    'Deleting scan'
  )

  if (result.success) {
    spinner.success('Scan deleted successfully')
  } else {
    handleUnsuccessfulApiResponse('deleteOrgFullScan', result, spinner)
  }
}
