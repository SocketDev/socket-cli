import { handleApiCall } from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchDeleteRepoOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchDeleteRepo(
  orgSlug: string,
  repoName: string,
  options?: FetchDeleteRepoOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'deleteRepository'>['data']>> {
  const { sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchDeleteRepoOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(sockSdk.deleteRepository(orgSlug, repoName), {
    description: 'to delete a repository',
  })
}
