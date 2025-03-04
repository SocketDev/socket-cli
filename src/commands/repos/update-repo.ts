import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

export async function updateRepo({
  default_branch,
  description,
  homepage,
  orgSlug,
  outputJson,
  outputMarkdown,
  repoName,
  visibility
}: {
  outputJson: boolean
  outputMarkdown: boolean
  orgSlug: string
  repoName: string
  description: string
  homepage: string
  default_branch: string
  visibility: string
}): Promise<void> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await updateRepoWithToken({
    apiToken,
    default_branch,
    description,
    homepage,
    orgSlug,
    outputJson,
    outputMarkdown,
    repoName,
    visibility
  })
}

async function updateRepoWithToken({
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
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Updating repository...')

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

  if (!result.success) {
    handleUnsuccessfulApiResponse('updateOrgRepo', result, spinner)
    return
  }

  spinner.successAndStop('Repository updated successfully')
}
