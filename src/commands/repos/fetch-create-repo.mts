import constants from '../../constants.mts'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
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
}): Promise<CResult<SocketSdkReturnType<'createOrgRepo'>['data']>> {
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Sending request ot create a repository...')

  const result = await handleApiCall(
    sockSdk.createOrgRepo(orgSlug, {
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
    return handleFailedApiResponse('createOrgRepo', result)
  }

  return { ok: true, data: result.data }
}
