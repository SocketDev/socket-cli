import constants from '../../constants.mts'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDeleteRepo(
  orgSlug: string,
  repoName: string
): Promise<CResult<SocketSdkReturnType<'deleteOrgRepo'>['data']>> {
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Sending request to delete a repository...')

  const result = await handleApiCall(
    sockSdk.deleteOrgRepo(orgSlug, repoName),
    'deleting repository'
  )

  spinner.successAndStop('Received response requesting to delete a repository.')

  if (!result.success) {
    return handleFailedApiResponse('deleteOrgRepo', result)
  }

  return { ok: true, data: result.data }
}
