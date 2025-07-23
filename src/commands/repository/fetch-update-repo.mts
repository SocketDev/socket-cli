import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchUpdateRepoConfig = {
  defaultBranch: string
  description: string
  homepage: string
  orgSlug: string
  repoName: string
  visibility: string
}

export type FetchUpdateRepoOptions = {
  sdkOptions?: SetupSdkOptions | undefined
}

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

  const { sdkOptions } = {
    __proto__: null,
    ...options,
  } as FetchUpdateRepoOptions

  const sockSdkCResult = await setupSdk(sdkOptions)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(
    sockSdk.updateOrgRepo(orgSlug, repoName, {
      default_branch: defaultBranch,
      description,
      homepage,
      name: repoName,
      orgSlug,
      visibility,
    }),
    { desc: 'to update a repository' },
  )
}
