import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

export async function updateRepo({
  apiToken,
  default_branch,
  description,
  homepage,
  orgSlug,
  outputJson,
  outputMarkdown,
  repoName,
  visibility
}: {
  apiToken: string
  outputJson: boolean
  outputMarkdown: boolean
  orgSlug: string
  repoName: string
  description: string
  homepage: string
  default_branch: string
  visibility: string
}): Promise<void> {
  const spinnerText = 'Updating repository... \n'
  const spinner = new Spinner({ text: spinnerText }).start()

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.updateOrgRepo(orgSlug, repoName, {
      outputJson,
      outputMarkdown,
      orgSlug,
      name: repoName,
      description,
      homepage,
      default_branch,
      visibility
    }),
    'updating repository'
  )

  if (result.success) {
    spinner.successAndStop('Repository updated successfully')
  } else {
    handleUnsuccessfulApiResponse('updateOrgRepo', result, spinner)
  }
}
