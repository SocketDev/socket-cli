import { fetchUpdateRepo } from './fetch-update-repo'
import { outputUpdateRepo } from './output-update-repo'

export async function handleUpdateRepo({
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
}): Promise<void> {
  const data = await fetchUpdateRepo({
    default_branch,
    description,
    homepage,
    orgSlug,
    repoName,
    visibility
  })
  if (!data) {
    return
  }

  await outputUpdateRepo(data)
}
