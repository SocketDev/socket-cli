import constants from '../../constants'
import { CResult } from '../../types'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchViewRepo(
  orgSlug: string,
  repoName: string
): Promise<CResult<SocketSdkReturnType<'getOrgRepo'>['data']>> {
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching repository data...')

  const result = await handleApiCall(
    sockSdk.getOrgRepo(orgSlug, repoName),
    'fetching repository'
  )

  spinner.successAndStop('Received response while fetched repository data.')

  if (!result.success) {
    return handleFailedApiResponse('getOrgRepo', result)
  }

  return { ok: true, data: result.data }
}
