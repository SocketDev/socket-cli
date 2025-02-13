import { Spinner } from '@socketsecurity/registry/lib/spinner'

import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api.ts'
import { setupSdk } from '../../utils/sdk.ts'

export async function getOrgScanMetadata(
  orgSlug: string,
  scanId: string,
  spinner: Spinner,
  apiToken: string
): Promise<void> {
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
