import { fetchListRepos } from './fetch-list-repos.mts'
import { outputListRepos } from './output-list-repos.mts'

import type { OutputKind } from '../../types.mts'

export async function handleListRepos({
  direction,
  orgSlug,
  outputKind,
  page,
  per_page,
  sort
}: {
  direction: string
  orgSlug: string
  outputKind: OutputKind
  page: number
  per_page: number
  sort: string
}): Promise<void> {
  const data = await fetchListRepos({
    direction,
    orgSlug,
    page,
    per_page,
    sort
  })

  await outputListRepos(data, outputKind)
}
