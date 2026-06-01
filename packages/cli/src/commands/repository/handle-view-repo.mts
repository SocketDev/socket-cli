import { fetchViewRepo } from './fetch-view-repo.mts'
import { outputViewRepo } from './output-view-repo.mts'

import type { OutputKind } from '../../types.mts'

export async function handleViewRepo(
  orgSlug: string,
  repoName: string,
  outputKind: OutputKind,
): Promise<void> {
  const data = await fetchViewRepo(orgSlug, repoName, {
    commandPath: 'socket repository view',
  })

  await outputViewRepo(data, outputKind)
}
