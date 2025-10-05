/** @fileoverview Organization dependencies API fetcher for Socket CLI. Retrieves organization-wide dependency list from Socket API. Returns dependency metadata including usage counts across repositories. */

import { withSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchDependenciesConfig = {
  limit: number
  offset: number
}

export type FetchDependenciesOptions = BaseFetchOptions

export async function fetchDependencies(
  config: FetchDependenciesConfig,
  options?: FetchDependenciesOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'searchDependencies'>['data']>> {
  const { limit, offset } = {
    __proto__: null,
    ...config,
  } as FetchDependenciesConfig

  return await withSdk(
    sdk => sdk.searchDependencies({ limit, offset }),
    'organization dependencies',
    options,
  )
}
