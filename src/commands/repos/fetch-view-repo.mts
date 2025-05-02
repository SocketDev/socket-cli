import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchViewRepo(
  orgSlug: string,
  repoName: string
): Promise<CResult<SocketSdkReturnType<'getOrgRepo'>['data']>> {
  const sockSdk = await setupSdk()

  return await handleApiCall(
    sockSdk.getOrgRepo(orgSlug, repoName),
    'Requesting repository data...',
    'Received API response (requested repository data).',
    'Error fetching repository data',
    'getOrgRepo'
  )
}
