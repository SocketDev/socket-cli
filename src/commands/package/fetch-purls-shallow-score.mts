import { logger } from '@socketsecurity/registry/lib/logger'

import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchPurlsShallowScoreOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchPurlsShallowScore(
  purls: string[],
  options?: FetchPurlsShallowScoreOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'batchPackageFetch'>>> {
  const { sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchPurlsShallowScoreOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  logger.info(
    `Requesting shallow score data for ${purls.length} package urls (purl): ${purls.join(', ')}`,
  )

  const batchPackageCResult = await handleApiCall(
    sockSdk.batchPackageFetch(
      { components: purls.map(purl => ({ purl })) },
      {
        alerts: 'true',
      },
    ),
    { desc: 'looking up package' },
  )
  if (!batchPackageCResult.ok) {
    return batchPackageCResult
  }

  // TODO: Seems like there's a bug in the typing since we absolutely have to
  // return the .data here.
  return {
    ok: true,
    data: batchPackageCResult.data as SocketSdkSuccessResult<'batchPackageFetch'>,
  }
}
