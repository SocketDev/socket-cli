import { fetchCreateRepo } from './fetch-create-repo'
import { outputCreateRepo } from './output-create-repo'

export async function handleCreateRepo({
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
  const data = await fetchCreateRepo({
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

  await outputCreateRepo(data)
}
