import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { RepositoryResult } from '@socketsecurity/sdk'

export type FetchCreateRepoConfig = {
  defaultBranch: string
  description: string
  homepage: string
  orgSlug: string
  repoName: string
  visibility: string
}

export type FetchCreateRepoOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchCreateRepo(
  config: FetchCreateRepoConfig,
  options?: FetchCreateRepoOptions | undefined,
): Promise<CResult<RepositoryResult['data']>> {
  const {
    defaultBranch,
    description,
    homepage,
    orgSlug,
    repoName,
    visibility,
  } = config

  const { sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchCreateRepoOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(
    sockSdk.createRepository(orgSlug, repoName, {
      default_branch: defaultBranch,
      description,
      homepage,
      visibility: visibility as 'private' | 'public',
    }),
    { description: 'to create a repository' },
  )
}
