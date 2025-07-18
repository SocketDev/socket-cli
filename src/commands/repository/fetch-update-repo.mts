import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchUpdateRepo({
  default_branch,
  description,
  homepage,
  orgSlug,
  repoName,
  visibility,
}: {
  orgSlug: string
  repoName: string
  description: string
  homepage: string
  default_branch: string
  visibility: string
}): Promise<CResult<SocketSdkReturnType<'updateOrgRepo'>['data']>> {
  const sockSdkCResult = await setupSdk()
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(
    sockSdk.updateOrgRepo(orgSlug, repoName, {
      orgSlug,
      name: repoName,
      description,
      homepage,
      default_branch,
      visibility,
    }),
    'to update a repository',
  )
}
