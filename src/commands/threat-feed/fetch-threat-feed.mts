import constants from '../../constants.mts'
import { handleApiError, queryApi } from '../../utils/api.mts'
import { getDefaultToken } from '../../utils/sdk.mts'

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

  const apiToken = getDefaultToken()
  if (!apiToken) {
    return {
      ok: false,
      message: 'Authentication Error',
      cause:
        'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    }
  }

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching Threat Feed data...')

  let result
  try {
    result = await queryApi(`threat-feed?${queryParams}`, apiToken)
  } catch (e) {
    spinner.failAndStop('The request was unsuccessful.')
    const msg = (e as undefined | { message: string })?.message

    return {
      ok: false,
      message: 'API Request failed to complete',
      ...(msg ? { cause: msg } : {})
    }
  }

  spinner.successAndStop('Received response while fetching Threat Feed data.')

  if (!result.ok) {
    const err = await handleApiError(result.status)
    return {
      ok: false,
      message: 'Socket API returned an error',
      cause: `${result.statusText}${err ? ` (cause: ${err})` : ''}`
    }
  }

  const data = (await result.json()) as
    | ThreadFeedResponse
    | { error: { message: string } }

  if ('error' in data && data.error) {
    return {
      ok: false,
      message: 'Socket API returned an error',
      cause: data.error.message
    }
  }

  return { ok: true, data: data as ThreadFeedResponse }
}
