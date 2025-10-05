/** @fileoverview Package shallow score API fetcher for Socket CLI. Retrieves quick security scores from Socket API for multiple packages in a single batch request. Optimized for bulk package lookups. */

import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'

import { withSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchPurlsShallowScoreOptions = BaseFetchOptions

export async function fetchPurlsShallowScore(
  purls: string[],
  options?: FetchPurlsShallowScoreOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'batchPackageFetch'>>> {
  const displayPurls =
    purls.length > 3
      ? `${purls.slice(0, 3).join(', ')} ... and ${purls.length - 3} more`
      : joinAnd(purls)
  logger.info(
    `Requesting shallow score data for ${purls.length} package urls (purl): ${displayPurls}`,
  )

  const batchPackageCResult = await withSdk(
    sdk =>
      sdk.batchPackageFetch(
        { components: purls.map(purl => ({ purl })) },
        {
          alerts: 'true',
        },
      ),
    'looking up package',
    options,
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
