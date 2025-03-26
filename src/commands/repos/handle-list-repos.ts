import { fetchListRepos } from './fetch-list-repos'
import { outputListRepos } from './output-list-repos'

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
  outputKind: 'json' | 'markdown' | 'print'
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
  if (!data) return

  await outputListRepos(data, outputKind)
}
