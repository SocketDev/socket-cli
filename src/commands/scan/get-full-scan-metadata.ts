import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

export async function getOrgScanMetadata(
  orgSlug: string,
  scanId: string,
  apiToken: string
): Promise<void> {
  const spinner = new Spinner()

  spinner.start("Getting scan's metadata...")

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
