import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDeleteRepo(
  orgSlug: string,
  repoName: string
): Promise<CResult<SocketSdkReturnType<'deleteOrgRepo'>['data']>> {
  const sockSdk = await setupSdk()

  return await handleApiCall(
    sockSdk.deleteOrgRepo(orgSlug, repoName),
    'Requesting to delete a repository...',
    'Received API response (requested to delete a repository).',
    'Error deleting repository',
    'deleteOrgRepo'
  )
}
