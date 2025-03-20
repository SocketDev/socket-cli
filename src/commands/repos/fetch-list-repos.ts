import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchListRepos({
  direction,
  orgSlug,
  page,
  per_page,
  sort
}: {
  direction: string
  orgSlug: string
  page: number
  per_page: number
  sort: string
}): Promise<SocketSdkReturnType<'getOrgRepoList'>['data'] | undefined> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  return await fetchListReposWithToken(apiToken, {
    direction,
    orgSlug,
    page,
    per_page,
    sort
  })
}

async function fetchListReposWithToken(
  apiToken: string,
  {
    direction,
    orgSlug,
    page,
    per_page,
    sort
  }: {
    direction: string
    orgSlug: string
    page: number
    per_page: number
    sort: string
  }
): Promise<SocketSdkReturnType<'getOrgRepoList'>['data'] | undefined> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  const socketSdk = await setupSdk(apiToken)

  spinner.start('Fetching list of repositories...')

  const result = await handleApiCall(
    socketSdk.getOrgRepoList(orgSlug, {
      sort,
      direction,
      per_page: String(per_page),
      page: String(page)
    }),
    'listing repositories'
  )

  spinner.successAndStop('Received response for repository list.')

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgRepoList', result)
    return
  }

  return result.data
}
