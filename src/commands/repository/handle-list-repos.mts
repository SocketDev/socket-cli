import { fetchListAllRepos } from './fetch-list-all-repos.mts'
import { fetchListRepos } from './fetch-list-repos.mts'
import { outputListRepos } from './output-list-repos.mts'

import type { Direction } from './types.mts'
import type { OutputKind } from '../../types.mts'

export async function handleListRepos({
  all,
  direction,
  orgSlug,
  outputKind,
  page,
  perPage,
  sort,
}: {
  all: boolean
  direction: Direction
  orgSlug: string
  outputKind: OutputKind
  page: number
  perPage: number
  sort: string
}): Promise<void> {
  if (all) {
    const data = await fetchListAllRepos(orgSlug, { direction, sort })

    await outputListRepos(data, outputKind, 0, 0, sort, Infinity, direction)
  } else {
    const data = await fetchListRepos({
      direction,
      orgSlug,
      page,
      perPage,
      sort,
    })

    if (!data.ok) {
      await outputListRepos(data, outputKind, 0, 0, '', 0, direction)
    } else {
      // Note: nextPage defaults to 0, is null when there's no next page.
      // The SDK's strict type marks it optional (absent === no next page), so
      // coalesce undefined to null to match outputListRepos's number | null.
      await outputListRepos(
        data,
        outputKind,
        page,
        data.data.nextPage ?? null,
        sort,
        perPage,
        direction,
      )
    }
  }
}
