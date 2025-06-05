import { fetchListAllRepos } from './fetch-list-all-repos.mts'
import { fetchListRepos } from './fetch-list-repos.mts'
import { outputListRepos } from './output-list-repos.mts'

import type { OutputKind } from '../../types.mts'

export async function handleListRepos({
  all,
  direction,
  orgSlug,
  outputKind,
  page,
  per_page,
  sort,
}: {
  all: boolean
  direction: 'asc' | 'desc'
  orgSlug: string
  outputKind: OutputKind
  page: number
  per_page: number
  sort: string
}): Promise<void> {
  if (all) {
    const data = await fetchListAllRepos({ direction, orgSlug, sort })

    await outputListRepos(data, outputKind, 0, 0, sort, Infinity, direction)
  } else {
    const data = await fetchListRepos({
      direction,
      orgSlug,
      page,
      per_page,
      sort,
    })

    if (!data.ok) {
      await outputListRepos(data, outputKind, 0, 0, '', 0, direction)
    } else {
      // Note: nextPage defaults to 0, is null when there's no next page
      await outputListRepos(
        data,
        outputKind,
        page,
        data.data.nextPage,
        sort,
        per_page,
        direction,
      )
    }
  }
}
