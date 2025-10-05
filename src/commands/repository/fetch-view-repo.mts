/** @fileoverview Repository view API fetcher for Socket CLI. Retrieves repository integration details from Socket API. Returns default branch, scan status, visibility settings, and metadata. */

import { withSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchViewRepoOptions = BaseFetchOptions

export async function fetchViewRepo(
  orgSlug: string,
  repoName: string,
  options?: FetchViewRepoOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgRepo'>['data']>> {
  return await withSdk(
    sdk => sdk.getOrgRepo(orgSlug, repoName),
    'repository data',
    options,
  )
}
