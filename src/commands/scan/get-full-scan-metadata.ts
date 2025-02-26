import { Spinner } from '@socketsecurity/registry/lib/spinner'

import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

export async function getOrgScanMetadata(
  orgSlug: string,
  scanId: string,
  apiToken: string
): Promise<void> {
  const spinnerText = "Getting scan's metadata... \n"
  const spinner = new Spinner({ text: spinnerText }).start()

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getOrgFullScanMetadata(orgSlug, scanId),
    'Listing scans'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgFullScanMetadata', result, spinner)
    return
  }

  spinner.stop('Scan metadata:')
  console.log(result.data)
}
