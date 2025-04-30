import constants from '../../constants.mts'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api.mts'
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
  sort
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
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching list of scans...')

  const result = await handleApiCall(
    sockSdk.getOrgFullScanList(orgSlug, {
      ...(branch ? { branch } : {}),
      ...(repo ? { repo } : {}),
      sort,
      direction,
      per_page: String(per_page),
      page: String(page),
      from: from_time
    }),
    'Listing scans'
  )

  spinner.successAndStop(`Received response for list of scans.`)

  if (!result.success) {
    return handleFailedApiResponse('getOrgFullScanList', result)
  }

  return { ok: true, data: result.data }
}
