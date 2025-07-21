import { logger } from '@socketsecurity/registry/lib/logger'

import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchPurlsShallowScoreOptions = {
  sdkOptions?: SetupSdkOptions | undefined
}

export async function fetchPurlsShallowScore(
  purls: string[],
  options?: FetchPurlsShallowScoreOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'batchPackageFetch'>>> {
  const { sdkOptions } = {
    __proto__: null,
    ...options,
  } as FetchPurlsShallowScoreOptions

  const sockSdkCResult = await setupSdk(sdkOptions)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  logger.info(
    `Requesting shallow score data for ${purls.length} package urls (purl): ${purls.join(', ')}`,
  )

  const result = await handleApiCall(
    sockSdk.batchPackageFetch(
      {
        alerts: 'true',
      },
      { components: purls.map(purl => ({ purl })) },
    ),
    { desc: 'looking up package' },
  )

  if (!result.ok) {
    return result
  }

  // TODO: seems like there's a bug in the typing since we absolutely have to return the .data here
  return {
    ok: true,
    data: result.data as SocketSdkSuccessResult<'batchPackageFetch'>,
  }
}
