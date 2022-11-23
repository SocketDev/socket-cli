import chalk from 'chalk'
import { ErrorWithCause } from 'pony-cause'

import { AuthError } from './errors.js'

/**
 * @template T
 * @param {import('@socketsecurity/sdk').SocketSdkErrorType<T>} result
 * @param {import('ora').Ora} spinner
 * @returns {void}
 */
export function handleUnsuccessfulApiResponse (result, spinner) {
  const resultError = 'error' in result && result.error && typeof result.error === 'object' ? result.error : {}
  const message = 'message' in resultError && typeof resultError.message === 'string' ? resultError.message : 'No error message returned'

  if (result.status === 401 || result.status === 403) {
    spinner.stop()
    throw new AuthError(message)
  }
  spinner.fail(chalk.white.bgRed('API returned an error:') + ' ' + message)
  process.exit(1)
}

/**
 * @template T
 * @param {Promise<T>} value
 * @param {import('ora').Ora} spinner
 * @param {string} description
 * @returns {Promise<T>}
 */
export async function handleApiCall (value, spinner, description) {
  /** @type {T} */
  let result

  try {
    result = await value
  } catch (cause) {
    spinner.fail()
    throw new ErrorWithCause(`Failed ${description}`, { cause })
  }

  return result
}
