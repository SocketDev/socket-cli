import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchLicensePolicy(
  orgSlug: string
): Promise<SocketSdkReturnType<'getOrgLicensePolicy'>['data'] | undefined> {
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
    handleUnsuccessfulApiResponse('getOrgLicensePolicy', result)
    return
  }

  return result.data
}
