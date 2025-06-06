import { fetchUpdateRepo } from './fetch-update-repo.mts'
import { outputUpdateRepo } from './output-update-repo.mts'

import type { OutputKind } from '../../types.mts'

export async function handleUpdateRepo(
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
  const data = await fetchUpdateRepo({
    default_branch,
    description,
    homepage,
    orgSlug,
    repoName,
    visibility,
  })

  await outputUpdateRepo(data, repoName, outputKind)
}
