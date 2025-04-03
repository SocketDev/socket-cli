import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchSupportedScanFileNames(): Promise<
  SocketSdkReturnType<'getReportSupportedFiles'>['data'] | undefined
> {
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Requesting supported scan file types from API...')

  const result = await handleApiCall(
    sockSdk.getReportSupportedFiles(),
    'fetching supported scan file types'
  )

  spinner.stop()
  logger.success('Received response while fetched supported scan file types.')

  if (!result.success) {
    handleUnsuccessfulApiResponse('getReportSupportedFiles', result)
  }

  return result.data
}
