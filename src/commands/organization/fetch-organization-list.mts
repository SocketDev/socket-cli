import constants from '../../constants.mts'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchOrganization(): Promise<
  CResult<SocketSdkReturnType<'getOrganizations'>['data']>
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
    return handleFailedApiResponse('getOrganizations', result)
  }

  return { ok: true, data: result.data }
}
