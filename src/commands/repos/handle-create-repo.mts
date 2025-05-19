import { fetchCreateRepo } from './fetch-create-repo.mts'
import { outputCreateRepo } from './output-create-repo.mts'

import type { OutputKind } from '../../types.mts'

export async function handleCreateRepo(
  {
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
  },
  outputKind: OutputKind,
): Promise<void> {
  const data = await fetchCreateRepo({
    default_branch,
    description,
    homepage,
    orgSlug,
    repoName,
    visibility,
  })
  outputCreateRepo(data, repoName, outputKind)
}
