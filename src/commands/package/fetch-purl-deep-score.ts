import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleApiCall, handleApiError, queryApi } from '../../utils/api'
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
  let result
  try {
    result = await queryApi(`purl/score/${encodeURIComponent(purl)}`, apiToken)
    spinner?.successAndStop('Received deep package score response.')
  } catch (e) {
    spinner?.failAndStop('The request was unsuccessful.')
    const msg = (e as undefined | { message: string })?.message
    if (msg) {
      logger.fail(msg)
      logger.log(
        'Please report this if the error persists or use the cli version that includes error reporting to automate that'
      )
    } else {
      logger.log(
        'An error happened but no reason was given. If this persists please let us know about it and what you were trying to achieve. Thank you.'
      )
    }
    return
  }

  if (!result.ok) {
    const err = await handleApiError(result.status)
    logger.fail(
      `${colors.bgRed(colors.bold(colors.white(' ' + result.statusText + ' ')))}: ${err}`
    )
    process.exitCode = 1
    return
  }

  const data = await handleApiCall(await result.text(), 'Reading text')

  try {
    return JSON.parse(data)
  } catch (e) {
    throw new Error(
      'Was unable to JSON parse the input from the server. It may not have been a proper JSON response. Please report this problem.'
    )
  }
}
