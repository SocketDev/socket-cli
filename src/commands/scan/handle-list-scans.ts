import { fetchListScans } from './fetch-list-scans'
import { outputListScans } from './output-list-scans'

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
  outputKind: 'json' | 'markdown' | 'print'
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
  if (!data) {
    return
  }

  await outputListScans(data, outputKind)
}
