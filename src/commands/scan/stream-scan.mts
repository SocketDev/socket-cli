import { logger } from '@socketsecurity/registry/lib/logger'

import { handleApiCall, handleFailedApiResponse } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

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
    // Note: this is always --json
    const result = handleFailedApiResponse('getOrgFullScan', data)
    logger.log(serializeResultJson(result))
    return
  }
}
