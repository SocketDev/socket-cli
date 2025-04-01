import { fetchThreatFeed } from './fetch-threat-feed'
import { outputThreatFeed } from './output-threat-feed'

import type { ThreadFeedResponse } from './types'

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
  outputKind: 'json' | 'markdown' | 'text'
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
  if (!data) {
    return
  }

  if ('error' in data && data.error) {
    console.log(data.error.message)
    return
  }

  await outputThreatFeed(data as ThreadFeedResponse, {
    outputKind
  })
}
