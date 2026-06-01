import { fetchThreatFeed } from './fetch-threat-feed.mts'
import { outputThreatFeed } from './output-threat-feed.mts'

import type { OutputKind } from '../../types.mts'

export async function handleThreatFeed({
  direction,
  ecosystem,
  filter,
  orgSlug,
  outputKind,
  page,
  perPage,
  pkg,
  version,
}: {
  direction: string
  ecosystem: string
  filter: string
  outputKind: OutputKind
  orgSlug: string
  page: string
  perPage: number
  pkg: string
  version: string
}): Promise<void> {
  const data = await fetchThreatFeed({
    direction,
    ecosystem,
    filter,
    orgSlug,
    page,
    perPage,
    pkg,
    version,
  })

  await outputThreatFeed(data, outputKind)
}
