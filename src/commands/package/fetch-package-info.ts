import { logger } from '@socketsecurity/registry/lib/logger'
import { SocketSdkResultType, SocketSdkReturnType } from '@socketsecurity/sdk'

import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { getPublicToken, setupSdk } from '../../utils/sdk'

export async function fetchPackageInfo(
  purls: string[]
): Promise<SocketSdkReturnType<'batchPackageFetch'>> {
  const socketSdk = await setupSdk(getPublicToken())

  // Lazily access constants.spinner.
  const { spinner } = constants

  logger.error(
    `Requesting data for ${purls.length} package urls (purl): ${purls.join(', ')}`
  )
  spinner.start(`Requesting data ...`)

  const result: Awaited<SocketSdkResultType<'batchPackageFetch'>> =
    await handleApiCall(
      socketSdk.batchPackageFetch(
        {
          alerts: 'true'
          // compact: false,
          // fixable: false,
          // licenseattrib: false,
          // licensedetails: false
        },
        { components: purls.map(purl => ({ purl })) }
      ),
      'looking up package'
    )

  spinner.successAndStop('Request completed')

  if (result.success) {
    return result
  } else {
    handleUnsuccessfulApiResponse('batchPackageFetch', result)
  }
}
