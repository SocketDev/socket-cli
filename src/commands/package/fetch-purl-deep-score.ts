import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleAPIError, handleApiCall, queryAPI } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken } from '../../utils/sdk'

export async function fetchPurlDeepScore(purl: string) {
  // Lazily access constants.spinner.
  const { spinner } = constants

  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  spinner.start('Getting deep package score...')
  const response = await queryAPI(
    `purl/score/${encodeURIComponent(purl)}`,
    apiToken
  )
  spinner?.successAndStop('Received deep package score response.')

  if (!response.ok) {
    const err = await handleAPIError(response.status)
    logger.log('\nThere was an error', err)
    spinner.errorAndStop(
      `${colors.bgRed(colors.white(response.statusText))}: ${err}`
    )
    return
  }

  const result = await handleApiCall(await response.text(), 'Reading text')

  try {
    return JSON.parse(result)
  } catch (e) {
    throw new Error(
      'Was unable to JSON parse the input from the server. It may not have been a proper JSON response. Please report this problem.'
    )
  }
}
