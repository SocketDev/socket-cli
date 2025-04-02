import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchOrganization(): Promise<
  SocketSdkReturnType<'getOrganizations'>['data'] | undefined
> {
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching organization list...')

  const result = await handleApiCall(
    sockSdk.getOrganizations(),
    'looking up organizations'
  )

  spinner.successAndStop('Received organization list response.')

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrganizations', result)
  }

  return result.data
}
