import constants from '../../constants.mts'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api.mts'
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

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching list of repositories...')

  const result = await handleApiCall(
    sockSdk.getOrgRepoList(orgSlug, {
      sort,
      direction,
      per_page: String(per_page),
      page: String(page)
    }),
    'listing repositories'
  )

  spinner.successAndStop('Received response for repository list.')

  if (!result.success) {
    return handleFailedApiResponse('getOrgRepoList', result)
  }

  return { ok: true, data: result.data }
}
