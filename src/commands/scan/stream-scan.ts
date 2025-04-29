import { logger } from '@socketsecurity/registry/lib/logger'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

export async function streamScan(
  orgSlug: string,
  scanId: string,
  file: string | undefined
) {
  const sockSdk = await setupSdk()

  logger.error('Requesting data from API...')

  // Note: this will write to stdout or target file. It's not a noop
  const data = await handleApiCall(
    sockSdk.getOrgFullScan(orgSlug, scanId, file === '-' ? undefined : file),
    'Fetching a scan'
  )

  if (!data?.success) {
    handleUnsuccessfulApiResponse('getOrgFullScan', data)
  }
}
