import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDeleteRepo(
  orgSlug: string,
  repoName: string
): Promise<CResult<SocketSdkReturnType<'deleteOrgRepo'>['data']>> {
  const sockSdkResult = await setupSdk()
  if (!sockSdkResult.ok) {
    return sockSdkResult
  }
  const sockSdk = sockSdkResult.data

  return await handleApiCall(
    sockSdk.deleteOrgRepo(orgSlug, repoName),
    'to delete a repository'
  )
}
