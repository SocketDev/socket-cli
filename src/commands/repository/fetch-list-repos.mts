/** @fileoverview Repository list API fetcher for Socket CLI. Retrieves paginated repository list from Socket API. Supports sorting, filtering, and pagination for organization repositories. */

import { withSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchListReposConfig = {
  direction: string
  orgSlug: string
  page: number
  perPage: number
  sort: string
}

export type FetchListReposOptions = BaseFetchOptions

export async function fetchListRepos(
  config: FetchListReposConfig,
  options?: FetchListReposOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgRepoList'>['data']>> {
  const { direction, orgSlug, page, perPage, sort } = {
    __proto__: null,
    ...config,
  } as FetchListReposConfig

  return await withSdk(
    sdk =>
      sdk.getOrgRepoList(orgSlug, {
        sort,
        direction,
        per_page: String(perPage),
        page: String(page),
      }),
    'list of repositories',
    options,
  )
}
