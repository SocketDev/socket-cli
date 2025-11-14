import { handleApiCall } from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchListReposConfig = {
  direction: string
  orgSlug: string
  page: number
  perPage: number
  sort: string
}

export type FetchListReposOptions = {
  commandPath?: string | undefined
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchListRepos(
  config: FetchListReposConfig,
  options?: FetchListReposOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'listRepositories'>['data']>> {
  const { direction, orgSlug, page, perPage, sort } = {
    __proto__: null,
    ...config,
  } as FetchListReposConfig

  const { commandPath, sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchListReposOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall<'listRepositories'>(
    sockSdk.listRepositories(orgSlug, {
      ...(sort ? { sort: sort as 'name' | 'created_at' } : {}),
      ...(direction ? { direction: direction as 'asc' | 'desc' } : {}),
      per_page: perPage,
      page,
    }),
    {
      commandPath,
      description: 'list of repositories',
    },
  )
}
