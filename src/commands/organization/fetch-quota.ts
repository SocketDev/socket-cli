import constants from '../../constants'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { CResult } from '../../types'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchQuota(): Promise<
  CResult<SocketSdkReturnType<'getQuota'>['data']>
> {
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching organization quota...')

  const result = await handleApiCall(
    sockSdk.getQuota(),
    'looking up organization quota'
  )

  spinner.successAndStop('Received organization quota response.')

  if (!result.success) {
    return handleFailedApiResponse('getQuota', result)
  }

  return { ok: true, data: result.data }
}
