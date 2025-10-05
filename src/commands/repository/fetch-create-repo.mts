/** @fileoverview Repository create API fetcher for Socket CLI. Creates repository integration via Socket API. Configures default branch and enables security scanning for GitHub repository. */

import { withSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchCreateRepoConfig = {
  defaultBranch: string
  description: string
  homepage: string
  orgSlug: string
  repoName: string
  visibility: string
}

export type FetchCreateRepoOptions = BaseFetchOptions

export async function fetchCreateRepo(
  config: FetchCreateRepoConfig,
  options?: FetchCreateRepoOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'createOrgRepo'>['data']>> {
  const {
    defaultBranch,
    description,
    homepage,
    orgSlug,
    repoName,
    visibility,
  } = config

  return await withSdk(
    sdk =>
      sdk.createOrgRepo(orgSlug, {
        default_branch: defaultBranch,
        description,
        homepage,
        name: repoName,
        visibility,
      }),
    'to create a repository',
    options,
  )
}
