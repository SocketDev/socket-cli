import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchQuota(): Promise<
  SocketSdkReturnType<'getQuota'>['data'] | undefined
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
    handleUnsuccessfulApiResponse('getQuota', result)
    return
  }

  return result.data
}
