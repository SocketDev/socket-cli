import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchCreateRepo({
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
}): Promise<SocketSdkReturnType<'createOrgRepo'>['data'] | undefined> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  return await fetchCreateRepoWithToken(apiToken, {
    default_branch,
    description,
    homepage,
    orgSlug,
    repoName,
    visibility
  })
}

async function fetchCreateRepoWithToken(
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
): Promise<SocketSdkReturnType<'createOrgRepo'>['data'] | undefined> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  const socketSdk = await setupSdk(apiToken)

  spinner.start('Sending request ot create a repository...')

  const result = await handleApiCall(
    socketSdk.createOrgRepo(orgSlug, {
      name: repoName,
      description,
      homepage,
      default_branch,
      visibility
    }),
    'creating repository'
  )

  spinner.successAndStop('Received response requesting to create a repository.')

  if (!result.success) {
    handleUnsuccessfulApiResponse('createOrgRepo', result)
    return
  }

  return result.data
}
