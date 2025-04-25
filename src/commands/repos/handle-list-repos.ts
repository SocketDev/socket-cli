import { fetchListRepos } from './fetch-list-repos'
import { outputListRepos } from './output-list-repos'

import type { OutputKind } from '../../types'

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
  if (!data) {
    return
  }

  await outputListRepos(data, outputKind)
}
