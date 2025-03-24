import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDeleteOrgFullScan(
  orgSlug: string,
  scanId: string
): Promise<SocketSdkReturnType<'deleteOrgFullScan'>['data'] | void> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await fetchDeleteOrgFullScanWithToken(apiToken, orgSlug, scanId)
}

async function fetchDeleteOrgFullScanWithToken(
  apiToken: string,
  orgSlug: string,
  scanId: string
): Promise<SocketSdkReturnType<'deleteOrgFullScan'>['data'] | void> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  const sockSdk = await setupSdk(apiToken)

  spinner.start('Requesting the scan to be deleted...')

  const result = await handleApiCall(
    sockSdk.deleteOrgFullScan(orgSlug, scanId),
    'Deleting scan'
  )

  spinner.successAndStop('Received response for deleting a scan.')

  if (!result.success) {
    handleUnsuccessfulApiResponse('deleteOrgFullScan', result)
    return
  }

  return result.data
}
