import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchUpdateRepo({
  default_branch,
  description,
  homepage,
  orgSlug,
  repoName,
  visibility
}: {
  orgSlug: string
  repoName: string
  description: string
  homepage: string
  default_branch: string
  visibility: string
}): Promise<SocketSdkReturnType<'updateOrgRepo'>['data'] | undefined> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  return await fetchUpdateRepoWithToken(apiToken, {
    default_branch,
    description,
    homepage,
    orgSlug,
    repoName,
    visibility
  })
}

async function fetchUpdateRepoWithToken(
  apiToken: string,
  {
    default_branch,
    description,
    homepage,
    orgSlug,
    repoName,
    visibility
  }: {
    orgSlug: string
    repoName: string
    description: string
    homepage: string
    default_branch: string
    visibility: string
  }
): Promise<SocketSdkReturnType<'updateOrgRepo'>['data'] | undefined> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Sending request to update a repository...')

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.updateOrgRepo(orgSlug, repoName, {
      orgSlug,
      name: repoName,
      description,
      homepage,
      default_branch,
      visibility
    }),
    'updating repository'
  )

  spinner.successAndStop('Received response trying to update a repository')

  if (!result.success) {
    handleUnsuccessfulApiResponse('updateOrgRepo', result)
    return
  }

  return result.data
}
