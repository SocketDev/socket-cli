import { handleApiCall } from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchViewRepoOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchViewRepo(
  orgSlug: string,
  repoName: string,
  options?: FetchViewRepoOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getRepository'>['data']>> {
  const { sdkOpts } = { __proto__: null, ...options } as FetchViewRepoOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall<'getRepository'>(
    sockSdk.getRepository(orgSlug, repoName),
    {
      description: 'repository data',
    },
  )
}
