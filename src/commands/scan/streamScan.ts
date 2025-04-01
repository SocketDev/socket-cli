import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { SocketSdkResultType } from '@socketsecurity/sdk'

export async function streamScan(
  orgSlug: string,
  scanId: string,
  file: string | undefined
): Promise<SocketSdkResultType<'getOrgFullScan'> | undefined> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  const sockSdk = await setupSdk()

  spinner.start('Fetching scan...')

  const data = await handleApiCall(
    sockSdk.getOrgFullScan(orgSlug, scanId, file === '-' ? undefined : file),
    'Fetching a scan'
  )

  spinner.successAndStop(
    file ? `Full scan details written to ${file}` : 'stdout'
  )

  if (!data?.success) {
    handleUnsuccessfulApiResponse('getOrgFullScan', data)
    return
  }

  return data
}
