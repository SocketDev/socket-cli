import constants from '../../constants'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { CResult } from '../../types'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchLicensePolicy(
  orgSlug: string
): Promise<CResult<SocketSdkReturnType<'getOrgLicensePolicy'>['data']>> {
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching organization license policy...')

  const result = await handleApiCall(
    sockSdk.getOrgLicensePolicy(orgSlug),
    'looking up organization quota'
  )

  spinner.successAndStop('Received organization license policy response.')

  if (!result.success) {
    return handleFailedApiResponse('getOrgLicensePolicy', result)
  }

  return { ok: true, data: result.data }
}
