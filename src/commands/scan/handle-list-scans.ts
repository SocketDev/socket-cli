import { fetchListScans } from './fetch-list-scans'
import { outputListScans } from './output-list-scans'

import type { OutputKind } from '../../types'

export async function handleListScans({
  branch,
  direction,
  from_time,
  orgSlug,
  outputKind,
  page,
  per_page,
  repo,
  sort
}: {
  branch: string
  direction: string
  from_time: string
  orgSlug: string
  outputKind: OutputKind
  page: number
  per_page: number
  repo: string
  sort: string
}): Promise<void> {
  const data = await fetchListScans({
    branch,
    direction,
    from_time,
    orgSlug,
    page,
    per_page,
    repo,
    sort
  })

  await outputListScans(data, outputKind)
}
