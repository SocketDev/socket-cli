import { fetchViewRepo } from './fetch-view-repo'
import { outputViewRepo } from './output-view-repo'

export async function handleViewRepo(
  orgSlug: string,
  repoName: string,
  outputKind: 'json' | 'markdown' | 'text'
): Promise<void> {
  const data = await fetchViewRepo(orgSlug, repoName)
  if (!data) {
    return
  }

  await outputViewRepo(data, outputKind)
}
