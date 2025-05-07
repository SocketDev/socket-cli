import { queryApiSafeJson } from '../../utils/api.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDiffScan({
  after,
  before,
  orgSlug
}: {
  after: string
  before: string
  orgSlug: string
}): Promise<CResult<SocketSdkReturnType<'GetOrgDiffScan'>['data']>> {
  return await queryApiSafeJson<SocketSdkReturnType<'GetOrgDiffScan'>['data']>(
    `orgs/${orgSlug}/full-scans/diff?before=${encodeURIComponent(before)}&after=${encodeURIComponent(after)}`,
    'a scan diff'
  )
}
