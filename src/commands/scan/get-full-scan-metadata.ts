import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

export async function getOrgScanMetadata(
  orgSlug: string,
  scanId: string,
  apiToken: string
): Promise<void> {
  // Lazily access constants.spinner.
  const { spinner } = constants

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
