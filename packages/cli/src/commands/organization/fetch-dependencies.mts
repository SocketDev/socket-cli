import { handleApiCall } from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchDependenciesConfig = {
  limit: number
  offset: number
}

export type FetchDependenciesOptions = {
  commandPath?: string | undefined
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchDependencies(
  config: FetchDependenciesConfig,
  options?: FetchDependenciesOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'searchDependencies'>['data']>> {
  const { commandPath, sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchDependenciesOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  const { limit, offset } = {
    __proto__: null,
    ...config,
  } as FetchDependenciesConfig

  return await handleApiCall<'searchDependencies'>(
    sockSdk.searchDependencies({ limit, offset }),
    {
      commandPath,
      description: 'organization dependencies',
    },
  )
}
