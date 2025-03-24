import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchListScans({
  direction,
  from_time,
  orgSlug,
  page,
  per_page,
  sort
}: {
  direction: string
  from_time: string
  orgSlug: string
  page: number
  per_page: number
  sort: string
}): Promise<SocketSdkReturnType<'getOrgFullScanList'>['data'] | void> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await fetchListScansWithToken(apiToken, {
    direction,
    from_time,
    orgSlug,
    page,
    per_page,
    sort
  })
}

async function fetchListScansWithToken(
  apiToken: string,
  {
    direction,
    from_time,
    orgSlug,
    page,
    per_page,
    sort
  }: {
    direction: string
    from_time: string // seconds
    orgSlug: string
    page: number
    per_page: number
    sort: string
  }
): Promise<SocketSdkReturnType<'getOrgFullScanList'>['data'] | void> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  const sockSdk = await setupSdk(apiToken)

  spinner.start('Fetching list of scans...')

  const result = await handleApiCall(
    sockSdk.getOrgFullScanList(orgSlug, {
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
    return
  }

  return result.data
}
