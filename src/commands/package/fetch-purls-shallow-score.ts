import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api'
import { getPublicToken, setupSdk } from '../../utils/sdk'

import type { CResult } from '../../types'
import type {
  SocketSdkResultType,
  SocketSdkReturnType
} from '@socketsecurity/sdk'

export async function fetchPurlsShallowScore(
  purls: string[]
): Promise<CResult<SocketSdkReturnType<'batchPackageFetch'>>> {
  logger.info(
    `Requesting shallow score data for ${purls.length} package urls (purl): ${purls.join(', ')}`
  )

  const sockSdk = await setupSdk(getPublicToken())

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start(`Requesting data ...`)

  const result: Awaited<SocketSdkResultType<'batchPackageFetch'>> =
    await handleApiCall(
      sockSdk.batchPackageFetch(
        {
          alerts: 'true'
        },
        { components: purls.map(purl => ({ purl })) }
      ),
      'looking up package'
    )

  spinner.successAndStop('Request completed')

  if (!result.success) {
    return handleFailedApiResponse('batchPackageFetch', result)
  }

  return { ok: true, data: result }
}
