import { queryApiSafeJson } from '../../utils/api.mts'

import type { ThreadFeedResponse } from './types.mts'
import type { CResult } from '../../types.mts'

export async function fetchThreatFeed({
  direction,
  ecosystem,
  filter,
  orgSlug,
  page,
  perPage,
  pkg,
  version,
}: {
  direction: string
  ecosystem: string
  filter: string
  orgSlug: string
  page: string
  perPage: number
  pkg: string
  version: string
}): Promise<CResult<ThreadFeedResponse>> {
  const queryParams = new URLSearchParams([
    ['direction', direction],
    ['ecosystem', ecosystem],
    filter ? ['filter', filter] : ['', ''],
    ['page_cursor', page],
    ['per_page', String(perPage)],
    pkg ? ['name', pkg] : ['', ''],
    version ? ['version', version] : ['', ''],
  ])

  return await queryApiSafeJson(
    `orgs/${orgSlug}/threat-feed?${queryParams}`,
    'the Threat Feed data',
  )
}
