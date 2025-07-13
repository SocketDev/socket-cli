import { logger } from '@socketsecurity/registry/lib/logger'

import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchPurlsShallowScore(
  purls: string[],
): Promise<CResult<SocketSdkReturnType<'batchPackageFetch'>>> {
  logger.info(
    `Requesting shallow score data for ${purls.length} package urls (purl): ${purls.join(', ')}`,
  )

  const sockSdkCResult = await setupSdk()
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  const result = await handleApiCall(
    sockSdk.batchPackageFetch(
      {
        alerts: 'true',
      },
      { components: purls.map(purl => ({ purl })) },
    ),
    'looking up package',
  )

  if (!result.ok) {
    return result
  }

  // TODO: seems like there's a bug in the typing since we absolutely have to return the .data here
  return {
    ok: true,
    data: result.data as SocketSdkReturnType<'batchPackageFetch'>,
  }
}
