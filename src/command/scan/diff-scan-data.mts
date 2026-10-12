import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { handleApiCall } from '../../util/socket/api.mjs'
import { setupSdk } from '../../util/socket/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk-stable'
const logger = getDefaultLogger()

export async function fetchDiffScan({
  id1,
  id2,
  orgSlug,
}: {
  id1: string
  id2: string
  orgSlug: string
}): Promise<CResult<SocketSdkSuccessResult<'getDiffScanById'>['data']>> {
  logger.info('Scan ID 1:', id1)
  logger.info('Scan ID 2:', id2)
  logger.info('Note: this request may take some time if the scans are big')

  const sockSdkCResult = await setupSdk()
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  const createResult = await handleApiCall<'createOrgDiffScanFromIds'>(
    sockSdk.createOrgDiffScanFromIds(orgSlug, {
      before: id1,
      after: id2,
      on_duplicate: 'redirect',
    }),
    {
      description: 'a scan diff creation',
    },
  )
  if (!createResult.ok) {
    return createResult
  }

  const diffScanId = createResult.data.diff_scan.id

  return await handleApiCall<'getDiffScanById'>(
    sockSdk.getDiffScanById(orgSlug, diffScanId, { cached: true }),
    {
      description: 'a scan diff',
    },
  )
}
