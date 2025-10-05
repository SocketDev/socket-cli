/** @fileoverview Repository delete API fetcher for Socket CLI. Removes repository integration via Socket API. Disables security scanning and removes repository from Socket organization. */

import { withSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchDeleteRepoOptions = BaseFetchOptions

export async function fetchDeleteRepo(
  orgSlug: string,
  repoName: string,
  options?: FetchDeleteRepoOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'deleteOrgRepo'>['data']>> {
  return await withSdk(
    sdk => sdk.deleteOrgRepo(orgSlug, repoName),
    'to delete a repository',
    options,
  )
}
