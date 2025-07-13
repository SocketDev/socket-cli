import { logger } from '@socketsecurity/registry/lib/logger'

import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

export async function streamScan(
  orgSlug: string,
  scanId: string,
  file: string | undefined,
) {
  const sockSdkCResult = await setupSdk()
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  logger.info('Requesting data from API...')

  // Note: this will write to stdout or target file. It's not a noop
  return await handleApiCall(
    sockSdk.getOrgFullScan(orgSlug, scanId, file === '-' ? undefined : file),
    'a scan',
  )
}
