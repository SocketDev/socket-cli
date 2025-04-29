import constants from '../../constants'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { CResult } from '../../types'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchSecurityPolicy(
  orgSlug: string
): Promise<CResult<SocketSdkReturnType<'getOrgSecurityPolicy'>['data']>> {
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
    return handleFailedApiResponse('getOrgSecurityPolicy', result)
  }

  return { ok: true, data: result.data }
}
