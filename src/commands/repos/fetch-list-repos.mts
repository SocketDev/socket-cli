import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchListRepos({
  direction,
  orgSlug,
  page,
  per_page,
  sort
}: {
  direction: string
  orgSlug: string
  page: number
  per_page: number
  sort: string
}): Promise<CResult<SocketSdkReturnType<'getOrgRepoList'>['data']>> {
  const sockSdk = await setupSdk()

  return await handleApiCall(
    sockSdk.getOrgRepoList(orgSlug, {
      sort,
      direction,
      per_page: String(per_page),
      page: String(page)
    }),
    'Requesting list of repositories...',
    'Received API response (requested list of repositories).',
    'Error fetching list of repositories',
    'getOrgRepoList'
  )
}
