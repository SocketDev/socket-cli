import chalk from 'chalk'
import { ErrorWithCause } from 'pony-cause'

import { AuthError } from './errors.js'

/**
 * @template {import('@socketsecurity/sdk').SocketSdkOperations} T
 * @param {T} _name
 * @param {import('@socketsecurity/sdk').SocketSdkErrorType<T>} result
 * @param {import('ora').Ora} spinner
 * @returns {never}
 */
export function handleUnsuccessfulApiResponse (_name, result, spinner) {
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
 * @param {string} description
 * @returns {Promise<T>}
 */
export async function handleApiCall (value, description) {
  /** @type {T} */
  let result

  try {
    result = await value
  } catch (cause) {
    throw new ErrorWithCause(`Failed ${description}`, { cause })
  }

  return result
}
