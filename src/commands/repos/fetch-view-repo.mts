import constants from '../../constants.mts'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
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
