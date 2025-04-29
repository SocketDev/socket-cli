import { fetchThreatFeed } from './fetch-threat-feed'
import { outputThreatFeed } from './output-threat-feed'

import type { OutputKind } from '../../types'

export async function handleThreatFeed({
  direction,
  ecosystem,
  filter,
  outputKind,
  page,
  perPage
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
    perPage
  })

  await outputThreatFeed(data, outputKind)
}
