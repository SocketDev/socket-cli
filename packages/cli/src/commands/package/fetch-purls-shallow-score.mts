import { joinAnd } from '@socketsecurity/lib/arrays'
import { logger } from '@socketsecurity/lib/logger'

import { handleApiCall } from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
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

  const displayPurls =
    purls.length > 3
      ? `${purls.slice(0, 3).join(', ')} … and ${purls.length - 3} more`
      : joinAnd(purls)
  logger.info(
    `Requesting shallow score data for ${purls.length} package urls (purl): ${displayPurls}`,
  )

  const batchPackageCResult = await handleApiCall(
    sockSdk.batchPackageFetch(
      { components: purls.map(purl => ({ purl })) },
      {
        alerts: 'true',
      },
    ),
    { description: 'looking up package' },
  )
  if (!batchPackageCResult.ok) {
    return batchPackageCResult
  }

  // Type assertion needed due to SDK result type mismatch.
  return {
    ok: true,
    data: batchPackageCResult.data as SocketSdkSuccessResult<'batchPackageFetch'>,
  }
}
