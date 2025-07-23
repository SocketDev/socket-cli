import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchListReposConfig = {
  direction: string
  orgSlug: string
  page: number
  perPage: number
  sort: string
}

export type FetchListReposOptions = {
  sdkOptions?: SetupSdkOptions | undefined
}

export async function fetchListRepos(
  config: FetchListReposConfig,
  options?: FetchListReposOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgRepoList'>['data']>> {
  const { direction, orgSlug, page, perPage, sort } = {
    __proto__: null,
    ...config,
  } as FetchListReposConfig

  const { sdkOptions } = {
    __proto__: null,
    ...options,
  } as FetchListReposOptions

  const sockSdkCResult = await setupSdk(sdkOptions)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(
    sockSdk.getOrgRepoList(orgSlug, {
      sort,
      direction,
      per_page: String(perPage),
      page: String(page),
    }),
    { desc: 'list of repositories' },
  )
}
