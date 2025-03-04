import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

export async function deleteOrgFullScan(
  orgSlug: string,
  fullScanId: string
): Promise<void> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await deleteOrgFullScanWithToken(orgSlug, fullScanId, apiToken)
}
export async function deleteOrgFullScanWithToken(
  orgSlug: string,
  fullScanId: string,
  apiToken: string
): Promise<void> {
  // Lazily access constants.spinner.
  const { spinner } = constants

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
