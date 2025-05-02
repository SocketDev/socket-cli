import constants from '../../constants.mts'
import { handleApiError, queryApi } from '../../utils/api.mts'
import { getDefaultToken } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { components } from '@socketsecurity/sdk/types/api'

export async function fetchScan(
  orgSlug: string,
  scanId: string
): Promise<CResult<Array<components['schemas']['SocketArtifact']>>> {
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

  spinner.start('Fetching scan data...')

  const response = await queryApi(
    `orgs/${orgSlug}/full-scans/${encodeURIComponent(scanId)}`,
    apiToken
  )

  spinner.successAndStop('Received response while fetching scan data.')

  if (!response.ok) {
    const cause = await handleApiError(response.status)
    return {
      ok: false,
      message: 'Socket API returned an error',
      cause: `${response.statusText}${cause ? ` (cause: ${cause})` : ''}`
    }
  }

  // This is nd-json; each line is a json object
  const jsons = await response.text()
  const lines = jsons.split('\n').filter(Boolean)
  let failed = false
  const data = lines.map(line => {
    try {
      return JSON.parse(line)
    } catch {
      failed = true
      return {}
    }
  }) as unknown as Array<components['schemas']['SocketArtifact']>

  if (failed) {
    return {
      ok: false,
      message: 'API response was invalid',
      cause:
        'At least one line item was returned that could not be parsed as JSON... Please report.'
    }
  }

  return { ok: true, data }
}
