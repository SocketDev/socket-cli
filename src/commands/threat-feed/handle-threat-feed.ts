import { logger } from '@socketsecurity/registry/lib/logger'

import { fetchThreatFeed } from './fetch-threat-feed'
import { outputThreatFeed } from './output-threat-feed'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge'

import type { ThreadFeedResponse } from './types'
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
  if (!data) {
    return
  }

  if ('error' in data && data.error) {
    logger.fail(failMsgWithBadge('Server Error', data.error.message))
    return
  }

  await outputThreatFeed(data as ThreadFeedResponse, {
    outputKind
  })
}
