import { fetchListAllRepos } from './all-repositories-data.mts'
import { fetchListRepos } from './repo-list-data.mts'
import { outputListRepos } from './output-list-repos.mts'

import type { Direction, RepositorySort } from './types.mts'
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
  sort: RepositorySort
}): Promise<void> {
  if (all) {
    const data = await fetchListAllRepos(orgSlug, {
      commandPath: 'socket repository list',
      direction,
      sort,
    })

    await outputListRepos(
      data,
      outputKind,
      0,
      0,
      sort,
      Number.POSITIVE_INFINITY,
      direction,
    )
  } else {
    const data = await fetchListRepos(
      {
        direction,
        orgSlug,
        page,
        perPage,
        sort,
      },
      {
        commandPath: 'socket repository list',
      },
    )

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
        perPage,
        direction,
      )
    }
  }
}
