import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchLicensePolicy(
  orgSlug: string
): Promise<SocketSdkReturnType<'getOrgLicensePolicy'>['data'] | undefined> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  return await fetchLicensePolicyWithToken(apiToken, orgSlug)
}

async function fetchLicensePolicyWithToken(
  apiToken: string,
  orgSlug: string
): Promise<SocketSdkReturnType<'getOrgLicensePolicy'>['data'] | undefined> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  const sockSdk = await setupSdk(apiToken)

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
