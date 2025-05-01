import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import { handleApiCall, handleApiError, queryApi } from '../../utils/api.mts'
import { getDefaultToken } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'

export interface PurlDataResponse {
  purl: string
  self: {
    purl: string
    score: {
      license: number
      maintenance: number
      overall: number
      quality: number
      supplyChain: number
      vulnerability: number
    }
    capabilities: string[]
    alerts: Array<{
      name: string
      severity: string
      category: string
      example: string
    }>
  }
  transitively: {
    dependencyCount: number
    func: string
    score: {
      license: number
      maintenance: number
      overall: number
      quality: number
      supplyChain: number
      vulnerability: number
    }
    lowest: {
      license: string
      maintenance: string
      overall: string
      quality: string
      supplyChain: string
      vulnerability: string
    }
    capabilities: string[]
    alerts: Array<{
      name: string
      severity: string
      category: string
      example: string
    }>
  }
}

export async function fetchPurlDeepScore(
  purl: string
): Promise<CResult<PurlDataResponse>> {
  logger.error(`Requesting deep score data for this purl: ${purl}`)

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

  spinner.start('Getting deep package score...')

  let result
  try {
    result = await queryApi(`purl/score/${encodeURIComponent(purl)}`, apiToken)
  } catch (e) {
    spinner.failAndStop('The request was unsuccessful.')
    const msg = (e as undefined | { message: string })?.message

    return {
      ok: false,
      message: 'API Request failed to complete',
      ...(msg ? { cause: msg } : {})
    }
  }

  spinner.successAndStop('Received deep package score response.')

  if (!result.ok) {
    const err = await handleApiError(result.status)
    return {
      ok: false,
      message: 'Socket API returned an error',
      cause: `${result.statusText}${err ? ` (cause: ${err})` : ''}`
    }
  }

  const data = await handleApiCall(await result.text(), 'Reading text')

  try {
    return { ok: true, data: JSON.parse(data) }
  } catch (e) {
    return {
      ok: false,
      message: 'Server returned invalid JSON',
      cause: `Please report this. JSON.parse threw an error over the following response: \`${data}\``
    }
  }
}
