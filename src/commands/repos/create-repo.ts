import { Spinner } from '@socketsecurity/registry/lib/spinner'

import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api.ts'
import { setupSdk } from '../../utils/sdk.ts'

export async function createRepo({
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
  const spinnerText = 'Creating repository... \n'
  const spinner = new Spinner({ text: spinnerText }).start()

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.createOrgRepo(orgSlug, {
      outputJson,
      outputMarkdown,
      orgSlug,
      name: repoName,
      description,
      homepage,
      default_branch,
      visibility
    }),
    'creating repository'
  )

  if (result.success) {
    spinner.success('Repository created successfully')
  } else {
    handleUnsuccessfulApiResponse('createOrgRepo', result, spinner)
  }
}
