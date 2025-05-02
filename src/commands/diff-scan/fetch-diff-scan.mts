import constants from '../../constants.mts'
import { handleApiError, queryApi } from '../../utils/api.mts'
import { getDefaultToken } from '../../utils/sdk.mts'

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
  const apiToken = getDefaultToken()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching diff-scan...')

  const response = await queryApi(
    `orgs/${orgSlug}/full-scans/diff?before=${encodeURIComponent(before)}&after=${encodeURIComponent(after)}`,
    apiToken || ''
  )

  spinner.successAndStop('Received diff-scan response')

  if (!response.ok) {
    const err = await handleApiError(response.status)
    return {
      ok: false,
      message: 'Socket API returned an error',
      cause: `${response.statusText}${err ? ` ( Reason: ${err} )` : ''}`
    }
  }

  const result =
    (await response.json()) as SocketSdkReturnType<'GetOrgDiffScan'>['data']

  return { ok: true, data: result }
}
