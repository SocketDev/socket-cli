import { handleApiCall } from '../../util/socket/api.mjs'
import { setupSdk } from '../../util/socket/sdk.mjs'
import { matchesConfirmedPurls } from './dependencies-filters.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../util/socket/sdk.mjs'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk-stable'

export type FetchDependenciesConfig = {
  limit: number
  offset: number
  purls?: string[] | undefined
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

  const { limit, offset, purls } = config

  const result = await handleApiCall<'searchDependencies'>(
    sockSdk.searchDependencies({
      limit,
      offset,
      ...(purls === undefined ? {} : { purls }),
    }),
    {
      commandPath,
      description: 'organization dependencies',
    },
  )

  if (
    result.ok &&
    purls !== undefined &&
    !matchesConfirmedPurls(purls, result.data.purlFilters)
  ) {
    return {
      ok: false,
      message: 'The server did not confirm every requested PURL filter.',
      cause:
        'Review the PURLs and try again. No dependency results were displayed because the filters may not have been applied.',
    }
  }

  return result
}
