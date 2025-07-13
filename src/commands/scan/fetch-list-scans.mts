import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchListScans({
  branch,
  direction,
  from_time,
  orgSlug,
  page,
  per_page,
  repo,
  sort,
}: {
  branch: string
  direction: string
  from_time: string
  orgSlug: string
  page: number
  per_page: number
  repo: string
  sort: string
}): Promise<CResult<SocketSdkReturnType<'getOrgFullScanList'>['data']>> {
  const sockSdkCResult = await setupSdk()
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(
    sockSdk.getOrgFullScanList(orgSlug, {
      ...(branch ? { branch } : {}),
      ...(repo ? { repo } : {}),
      sort,
      direction,
      per_page: String(per_page),
      page: String(page),
      from: from_time,
    }),
    'list of scans',
  )
}
