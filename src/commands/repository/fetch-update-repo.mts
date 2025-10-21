import { handleApiCall } from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
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
  sdkOpts?: SetupSdkOptions | undefined
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

  const { sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchUpdateRepoOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
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
    { description: 'to update a repository' },
  )
}
