import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchCreateRepoConfig = {
  defaultBranch: string
  description: string
  homepage: string
  orgSlug: string
  repoName: string
  visibility: string
}

export type FetchCreateRepoOptions = {
  sdkOptions?: SetupSdkOptions | undefined
}

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

  const { sdkOptions } = {
    __proto__: null,
    ...options,
  } as FetchCreateRepoOptions

  const sockSdkCResult = await setupSdk(sdkOptions)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(
    sockSdk.createOrgRepo(orgSlug, {
      default_branch: defaultBranch,
      description,
      homepage,
      name: repoName,
      visibility,
    }),
    { desc: 'to create a repository' },
  )
}
