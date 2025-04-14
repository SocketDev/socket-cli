import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

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
}): Promise<SocketSdkReturnType<'getOrgFullScanList'>['data'] | void> {
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
    handleUnsuccessfulApiResponse('getOrgFullScanList', result)
  }

  return result.data
}
