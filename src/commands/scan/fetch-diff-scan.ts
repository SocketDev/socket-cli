import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleApiCall, handleApiError, queryApi } from '../../utils/api'
import { getDefaultToken } from '../../utils/sdk'

import type { CResult } from '../../types'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDiffScan({
  id1,
  id2,
  orgSlug
}: {
  id1: string
  id2: string
  orgSlug: string
}): Promise<CResult<SocketSdkReturnType<'GetOrgDiffScan'>['data']>> {
  const apiToken = getDefaultToken()

  // Lazily access constants.spinner.
  const { spinner } = constants

  logger.error('Scan ID 1:', id1)
  logger.error('Scan ID 2:', id2)

  spinner.start('Fetching scan diff... (this may take a while)')

  const response = await queryApi(
    `orgs/${orgSlug}/full-scans/diff?before=${encodeURIComponent(id1)}&after=${encodeURIComponent(id2)}`,
    apiToken || ''
  )

  spinner.successAndStop('Received scan diff response')

  if (!response.ok) {
    const err = await handleApiError(response.status)
    return {
      ok: false,
      message: 'Socket API returned an error',
      cause: `${response.statusText}${err ? ` (cause: ${err}` : ''}`
    }
  }

  const result = await handleApiCall(
    (await response.json()) as Promise<
      SocketSdkReturnType<'GetOrgDiffScan'>['data']
    >,
    'Deserializing json'
  )

  return { ok: true, data: result }
}
