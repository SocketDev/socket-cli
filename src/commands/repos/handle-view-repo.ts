import { fetchViewRepo } from './fetch-view-repo'
import { outputViewRepo } from './output-view-repo'

import type { OutputKind } from '../../types'

export async function handleViewRepo(
  orgSlug: string,
  repoName: string,
  outputKind: OutputKind
): Promise<void> {
  const data = await fetchViewRepo(orgSlug, repoName)
  if (!data) {
    return
  }

  await outputViewRepo(data, outputKind)
}
