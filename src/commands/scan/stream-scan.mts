import { logger } from '@socketsecurity/registry/lib/logger'

import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

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
    'Fetching a scan',
    'Received API response (requested a scan).',
    'Error fetching a scan',
    'GetOrgFullScan'
  )

  return data
}
