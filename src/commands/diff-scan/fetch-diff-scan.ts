import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleApiCall, handleApiError, queryApi } from '../../utils/api'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge'
import { getDefaultToken } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDiffScan({
  after,
  before,
  orgSlug
}: {
  after: string
  before: string
  orgSlug: string
}): Promise<SocketSdkReturnType<'GetOrgDiffScan'>['data'] | undefined> {
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
    logger.fail(failMsgWithBadge(response.statusText, err))
    return
  }

  const result = await handleApiCall(
    (await response.json()) as Promise<
      SocketSdkReturnType<'GetOrgDiffScan'>['data']
    >,
    'Deserializing json'
  )

  return result
}
