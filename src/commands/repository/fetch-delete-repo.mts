import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDeleteRepo(
  orgSlug: string,
  repoName: string,
): Promise<CResult<SocketSdkReturnType<'deleteOrgRepo'>['data']>> {
  const sockSdkCResult = await setupSdk()
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(
    sockSdk.deleteOrgRepo(orgSlug, repoName),
    'to delete a repository',
  )
}
