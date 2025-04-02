import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchSecurityPolicy(
  orgSlug: string
): Promise<SocketSdkReturnType<'getOrgSecurityPolicy'>['data'] | undefined> {
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching organization security policy...')

  const result = await handleApiCall(
    sockSdk.getOrgSecurityPolicy(orgSlug),
    'looking up organization quota'
  )

  spinner.successAndStop('Received organization security policy response.')

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgSecurityPolicy', result)
  }

  return result.data
}
