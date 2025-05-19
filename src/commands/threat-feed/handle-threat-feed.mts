import { fetchThreatFeed } from './fetch-threat-feed.mts'
import { outputThreatFeed } from './output-threat-feed.mts'

import type { OutputKind } from '../../types.mts'

export async function handleThreatFeed({
  direction,
  ecosystem,
  filter,
  outputKind,
  page,
  perPage,
}: {
  direction: string
  ecosystem: string
  filter: string
  outputKind: OutputKind
  page: string
  perPage: number
}): Promise<void> {
  const data = await fetchThreatFeed({
    direction,
    ecosystem,
    filter,
    page,
    perPage,
  })

  await outputThreatFeed(data, outputKind)
}
