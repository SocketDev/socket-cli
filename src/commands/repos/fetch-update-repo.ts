import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

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
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Sending request to update a repository...')

  const result = await handleApiCall(
    sockSdk.updateOrgRepo(orgSlug, repoName, {
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
  }

  return result.data
}
