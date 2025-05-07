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
  const sockSdkResult = await setupSdk()
  if (!sockSdkResult.ok) {
    return sockSdkResult
  }
  const sockSdk = sockSdkResult.data

  return await handleApiCall(
    sockSdk.getOrgRepoList(orgSlug, {
      sort,
      direction,
      per_page: String(per_page),
      page: String(page)
    }),
    'list of repositories'
  )
}
