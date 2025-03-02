import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { SocketSdkResultType } from '@socketsecurity/sdk'

export async function getFullScan(
  orgSlug: string,
  fullScanId: string,
  file: string | undefined,
  apiToken: string
): Promise<SocketSdkResultType<'getOrgFullScan'>> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Streaming scan...')

  const socketSdk = await setupSdk(apiToken)
  const data = await handleApiCall(
    socketSdk.getOrgFullScan(
      orgSlug,
      fullScanId,
      file === '-' ? undefined : file
    ),
    'Streaming a scan'
  )

  if (data?.success) {
    spinner.stop(file ? `Full scan details written to ${file}` : '')
  } else {
    handleUnsuccessfulApiResponse('getOrgFullScan', data, spinner)
  }
  return data
}
