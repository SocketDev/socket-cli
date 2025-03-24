import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDependencies({
  limit,
  offset
}: {
  limit: number
  offset: number
}): Promise<SocketSdkReturnType<'searchDependencies'>['data'] | undefined> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  return await fetchDependenciesWithToken(apiToken, {
    limit,
    offset
  })
}

async function fetchDependenciesWithToken(
  apiToken: string,
  {
    limit,
    offset
  }: {
    limit: number
    offset: number
  }
): Promise<SocketSdkReturnType<'searchDependencies'>['data'] | undefined> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching organization dependencies...')

  const sockSdk = await setupSdk(apiToken)

  const result = await handleApiCall(
    sockSdk.searchDependencies({ limit, offset }),
    'Searching dependencies'
  )

  spinner?.successAndStop('Received organization dependencies response.')

  if (!result.success) {
    handleUnsuccessfulApiResponse('searchDependencies', result)
    return
  }

  return result.data
}
