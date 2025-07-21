import { logger } from '@socketsecurity/registry/lib/logger'

import { queryApiSafeJson } from '../../utils/api.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function fetchDiffScan({
  id1,
  id2,
  orgSlug,
}: {
  id1: string
  id2: string
  orgSlug: string
}): Promise<CResult<SocketSdkSuccessResult<'GetOrgDiffScan'>['data']>> {
  logger.info('Scan ID 1:', id1)
  logger.info('Scan ID 2:', id2)
  logger.info('Note: this request may take some time if the scans are big')

  return await queryApiSafeJson<
    SocketSdkSuccessResult<'GetOrgDiffScan'>['data']
  >(
    `orgs/${orgSlug}/full-scans/diff?before=${encodeURIComponent(id1)}&after=${encodeURIComponent(id2)}`,
    'a scan diff',
  )
}
