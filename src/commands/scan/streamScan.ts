import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { SocketSdkResultType } from '@socketsecurity/sdk'

export async function streamScan(
  orgSlug: string,
  scanId: string,
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

  const sockSdk = await setupSdk(apiToken)

  spinner.start('Fetching scan...')

  const data = await handleApiCall(
    sockSdk.getOrgFullScan(orgSlug, scanId, file === '-' ? undefined : file),
    'Fetching a scan'
  )

  spinner?.successAndStop(
    file ? `Full scan details written to ${file}` : 'stdout'
  )

  if (!data?.success) {
    handleUnsuccessfulApiResponse('getOrgFullScan', data)
    return
  }

  return data
}
