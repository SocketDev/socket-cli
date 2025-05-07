import { queryApiSafeJson } from '../../utils/api.mts'

import type { ThreadFeedResponse } from './types.mts'
import type { CResult } from '../../types.mts'

export async function fetchThreatFeed({
  direction,
  ecosystem,
  filter,
  page,
  perPage
}: {
  direction: string
  ecosystem: string
  filter: string
  page: string
  perPage: number
}): Promise<CResult<ThreadFeedResponse>> {
  const queryParams = new URLSearchParams([
    ['direction', direction],
    ['ecosystem', ecosystem],
    ['filter', filter],
    ['page', page],
    ['per_page', String(perPage)]
  ])

  return await queryApiSafeJson(
    `threat-feed?${queryParams}`,
    'the Threat Feed data'
  )
}
