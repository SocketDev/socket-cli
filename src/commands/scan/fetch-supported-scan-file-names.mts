import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchSupportedScanFileNames(): Promise<
  CResult<SocketSdkReturnType<'getReportSupportedFiles'>['data']>
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
    return handleFailedApiResponse('getReportSupportedFiles', result)
  }

  return { ok: true, data: result.data }
}
