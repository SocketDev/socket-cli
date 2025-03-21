import { fetchListScans } from './fetch-list-scans'
import { outputListScans } from './output-list-scans'

export async function handleListScans({
  direction,
  from_time,
  orgSlug,
  outputKind,
  page,
  per_page,
  sort
}: {
  direction: string
  from_time: string
  orgSlug: string
  outputKind: 'json' | 'markdown' | 'print'
  page: number
  per_page: number
  sort: string
}): Promise<void> {
  const data = await fetchListScans({
    direction,
    from_time,
    orgSlug,
    page,
    per_page,
    sort
  })
  if (!data) return

  await outputListScans(data, outputKind)
}
