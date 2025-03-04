import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

export async function createRepo({
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

  await createRepoWithToken({
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

async function createRepoWithToken({
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

  spinner.start('Creating repository...')

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

  if (!result.success) {
    handleUnsuccessfulApiResponse('createOrgRepo', result, spinner)
    return
  }

  spinner.successAndStop('Repository created successfully')
}
