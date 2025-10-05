/** @fileoverview Repository update API fetcher for Socket CLI. Updates repository integration settings via Socket API. Modifies default branch, visibility, and scanning configuration. */

import { withSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchUpdateRepoConfig = {
  defaultBranch: string
  description: string
  homepage: string
  orgSlug: string
  repoName: string
  visibility: string
}

export type FetchUpdateRepoOptions = BaseFetchOptions

export async function fetchUpdateRepo(
  config: FetchUpdateRepoConfig,
  options?: FetchUpdateRepoOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']>> {
  const {
    defaultBranch,
    description,
    homepage,
    orgSlug,
    repoName,
    visibility,
  } = { __proto__: null, ...config } as FetchUpdateRepoConfig

  return await withSdk(
    sdk =>
      sdk.updateOrgRepo(orgSlug, repoName, {
        default_branch: defaultBranch,
        description,
        homepage,
        name: repoName,
        orgSlug,
        visibility,
      }),
    'to update a repository',
    options,
  )
}
