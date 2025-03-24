import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchQuota(): Promise<
  SocketSdkReturnType<'getQuota'>['data'] | undefined
> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }
  return await fetchQuotaWithToken(apiToken)
}

async function fetchQuotaWithToken(
  apiToken: string
): Promise<SocketSdkReturnType<'getQuota'>['data'] | undefined> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  const sockSdk = await setupSdk(apiToken)

  spinner.start('Fetching organization quota...')

  const result = await handleApiCall(
    sockSdk.getQuota(),
    'looking up organization quota'
  )

  spinner?.successAndStop('Recieved organization quota response.')

  if (!result.success) {
    handleUnsuccessfulApiResponse('getQuota', result)
    return
  }

  return result.data
}
