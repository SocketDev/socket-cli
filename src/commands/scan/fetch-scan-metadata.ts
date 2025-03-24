import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchScanMetadata(
  orgSlug: string,
  scanId: string
): Promise<SocketSdkReturnType<'getOrgFullScanMetadata'>['data'] | void> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await fetchScanMetadataWithToken(apiToken, orgSlug, scanId)
}

async function fetchScanMetadataWithToken(
  apiToken: string,
  orgSlug: string,
  scanId: string
): Promise<SocketSdkReturnType<'getOrgFullScanMetadata'>['data'] | void> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  const sockSdk = await setupSdk(apiToken)

  spinner.start('Fetching meta data for a full scan...')

  const result = await handleApiCall(
    sockSdk.getOrgFullScanMetadata(orgSlug, scanId),
    'Listing scans'
  )

  spinner.successAndStop('Received response for scan meta data.')

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgFullScanMetadata', result)
    return
  }

  return result.data
}
