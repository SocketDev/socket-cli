import { fetchOrgFullScanList } from './fetch-list-scans.mts'
import { outputListScans } from './output-list-scans.mts'

import type { OutputKind } from '../../types.mts'

export async function handleListScans({
  branch,
  direction,
  from_time,
  orgSlug,
  outputKind,
  page,
  perPage,
  repo,
  sort,
}: {
  branch: string
  direction: string
  from_time: string
  orgSlug: string
  outputKind: OutputKind
  page: number
  perPage: number
  repo: string
  sort: string
}): Promise<void> {
  const data = await fetchOrgFullScanList({
    branch,
    direction,
    from_time,
    orgSlug,
    page,
    perPage,
    repo,
    sort,
  })

  await outputListScans(data, outputKind)
}
