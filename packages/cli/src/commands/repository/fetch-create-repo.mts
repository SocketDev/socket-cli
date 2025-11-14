import { handleApiCall } from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
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
  commandPath?: string | undefined
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchCreateRepo(
  config: FetchCreateRepoConfig,
  options?: FetchCreateRepoOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'createRepository'>['data']>> {
  const {
    defaultBranch,
    description,
    homepage,
    orgSlug,
    repoName,
    visibility,
  } = config

  const { commandPath, sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchCreateRepoOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall<'createRepository'>(
    sockSdk.createRepository(orgSlug, {
      default_branch: defaultBranch,
      description,
      homepage,
      name: repoName,
      visibility,
    }),
    {
      commandPath,
      description: 'to create a repository',
    },
  )
}
