import chalk from 'chalk'
import { ErrorWithCause } from 'pony-cause'

import { AuthError } from './errors'

import type {
  SocketSdkOperations,
  SocketSdkErrorType
} from '@socketsecurity/sdk'
import type { Ora } from 'ora'

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
  if(code === 400){
    return `Bad request`
  }
}

const API_V0_URL = 'https://api.socket.dev/v0'

export async function queryAPI(path: string, apiKey: string) {
  return await fetch(`${API_V0_URL}/orgs/${path}`, {
    method: 'GET', 
    headers: {
      'Authorization': 'Basic ' + btoa(`${apiKey}:${apiKey}`)
    }
  });
}