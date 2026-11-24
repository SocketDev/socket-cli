import { handleApiCall } from '../../utils/api.mts'
import { joinAnd } from '../../utils/arrays.mts'
import { logger } from '../../utils/logger.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { PurlRecord } from '@socketsecurity/sdk'

export type FetchPurlsShallowScoreOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchPurlsShallowScore(
  purls: string[],
  options?: FetchPurlsShallowScoreOptions | undefined,
): Promise<CResult<PurlRecord[]>> {
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
    `Requesting shallow score data for ${purls.length} package urls (purl): ${joinAnd(purls)}`,
  )

  const batchPackageCResult = await handleApiCall(
    sockSdk.batchPackageFetch(
      { components: purls.map(purl => ({ purl })) },
      {
        alerts: true,
      },
    ),
    { description: 'looking up package' },
  )
  if (!batchPackageCResult.ok) {
    return batchPackageCResult
  }

  return batchPackageCResult
}
