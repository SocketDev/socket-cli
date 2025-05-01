import constants from '../../constants.mts'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
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
}): Promise<CResult<SocketSdkReturnType<'updateOrgRepo'>['data']>> {
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
    return handleFailedApiResponse('updateOrgRepo', result)
  }

  return { ok: true, data: result.data }
}
