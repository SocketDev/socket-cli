import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchOrganization(): Promise<
  SocketSdkReturnType<'getOrganizations'>['data'] | undefined
> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  return await fetchOrganizationWithToken(apiToken)
}

async function fetchOrganizationWithToken(
  apiToken: string
): Promise<SocketSdkReturnType<'getOrganizations'>['data'] | undefined> {
  const sockSdk = await setupSdk(apiToken)

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
    return
  }

  return result.data
}
