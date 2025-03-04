import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { SocketSdkResultType } from '@socketsecurity/sdk'

export async function streamFullScan(
  orgSlug: string,
  fullScanId: string,
  file: string | undefined
): Promise<SocketSdkResultType<'getOrgFullScan'> | undefined> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  spinner.start('Fetching scan...')

  const socketSdk = await setupSdk(apiToken)
  const data = await handleApiCall(
    socketSdk.getOrgFullScan(
      orgSlug,
      fullScanId,
      file === '-' ? undefined : file
    ),
    'Fetching a scan'
  )

  if (!data?.success) {
    handleUnsuccessfulApiResponse('getOrgFullScan', data, spinner)
    return
  }

  spinner?.successAndStop(
    file ? `Full scan details written to ${file}` : 'stdout'
  )

  return data
}
