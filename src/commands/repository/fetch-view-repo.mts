import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchViewRepoOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchViewRepo(
  orgSlug: string,
  repoName: string,
  options?: FetchViewRepoOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgRepo'>['data']>> {
  const { sdkOpts } = { __proto__: null, ...options } as FetchViewRepoOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(sockSdk.getOrgRepo(orgSlug, repoName), {
    description: 'repository data',
  })
}
