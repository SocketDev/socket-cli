import constants from '../../constants'
import { queryApi } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken } from '../../utils/sdk'

import type { ThreadFeedResponse } from './types'

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
}): Promise<ThreadFeedResponse | { error: { message: string } }> {
  const queryParams = new URLSearchParams([
    ['direction', direction],
    ['ecosystem', ecosystem],
    ['filter', filter],
    ['page', page],
    ['per_page', String(perPage)]
  ])

  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching Threat Feed data...')

  const response = await queryApi(`threat-feed?${queryParams}`, apiToken)

  spinner.successAndStop('Received response while fetching Threat Feed data.')

  const data = await response.json()

  return data as ThreadFeedResponse | { error: { message: string } }
}
