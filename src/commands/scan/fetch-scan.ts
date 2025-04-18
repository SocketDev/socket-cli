import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleApiError, queryApi } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge'
import { getDefaultToken } from '../../utils/sdk'

import type { components } from '@socketsecurity/sdk/types/api'

export async function fetchScan(
  orgSlug: string,
  scanId: string
): Promise<Array<components['schemas']['SocketArtifact']> | undefined> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching scan data...')

  const response = await queryApi(
    `orgs/${orgSlug}/full-scans/${encodeURIComponent(scanId)}`,
    apiToken
  )

  spinner.successAndStop('Received response while fetching scan data.')

  if (!response.ok) {
    const err = await handleApiError(response.status)
    logger.fail(failMsgWithBadge(response.statusText, `Fetch error: ${err}`))
    return
  }

  // This is nd-json; each line is a json object
  const jsons = await response.text()
  const lines = jsons.split('\n').filter(Boolean)
  const data = lines.map(line => {
    try {
      return JSON.parse(line)
    } catch {
      console.error(
        'At least one line item was returned that could not be parsed as JSON...'
      )
      return {}
    }
  }) as unknown as Array<components['schemas']['SocketArtifact']>

  return data
}
