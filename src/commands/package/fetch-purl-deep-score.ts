import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleApiCall, handleApiError, queryApi } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge'
import { getDefaultToken } from '../../utils/sdk'

const { SOCKET_CLI_ISSUES_URL } = constants

export async function fetchPurlDeepScore(purl: string) {
  logger.info(`Requesting deep score data for this purl: ${purl}`)

  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Getting deep package score...')

  let result
  try {
    result = await queryApi(`purl/score/${encodeURIComponent(purl)}`, apiToken)
    spinner.successAndStop('Received deep package score response.')
  } catch (e) {
    spinner.failAndStop('The request was unsuccessful.')
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
    logger.fail(failMsgWithBadge(result.statusText, err))
    process.exitCode = 1
    return
  }

  const data = await handleApiCall(await result.text(), 'Reading text')

  try {
    return JSON.parse(data)
  } catch (e) {
    throw new Error(
      `Unable to parse JSON response from the Socket API.\nPlease report to ${SOCKET_CLI_ISSUES_URL}`
    )
  }
}
