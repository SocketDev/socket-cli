import chalk from 'chalk'
import { ErrorWithCause } from 'pony-cause'

import { AuthError } from './errors'

import type {
  SocketSdkErrorType,
  SocketSdkOperations
} from '@socketsecurity/sdk'
import type { Ora } from 'ora'
import { API_V0_URL } from '../constants'

export function handleUnsuccessfulApiResponse<T extends SocketSdkOperations>(
  _name: T,
  result: SocketSdkErrorType<T>,
  spinner: Ora
) {
  const resultError =
    'error' in result && result.error && typeof result.error === 'object'
      ? result.error
      : {}
  const message =
    'message' in resultError && typeof resultError.message === 'string'
      ? resultError.message
      : 'No error message returned'

  if (result.status === 401 || result.status === 403) {
    spinner.stop()
    throw new AuthError(message)
  }
  spinner.fail(chalk.white.bgRed('API returned an error:') + ' ' + message)
  process.exit(1)
}

export async function handleApiCall<T>(
  value: T,
  description: string
): Promise<T> {
  let result: T

  try {
    result = await value
  } catch (cause) {
    throw new ErrorWithCause(`Failed ${description}`, { cause })
  }

  return result
}

export async function handleAPIError(code: number) {
  if (code === 400) {
    return `One of the options passed might be incorrect.`
  } else if (code === 403) {
    return `You might be trying to access an organization that is not linked to the API key you are logged in with.`
  }
}

export async function queryAPI(path: string, apiKey: string) {
  return await fetch(`${API_V0_URL}/${path}`, {
    method: 'GET',
    headers: {
      Authorization: 'Basic ' + btoa(`${apiKey}:${apiKey}`)
    }
  })
}
