import process from 'node:process'

import { ErrorWithCause } from 'pony-cause'
import colors from 'yoctocolors-cjs'

import { AuthError } from './errors'
import constants from '../constants'

import type { Spinner } from '@socketsecurity/registry/lib/spinner'
import type {
  SocketSdkErrorType,
  SocketSdkOperations
} from '@socketsecurity/sdk'

const { API_V0_URL } = constants

export function handleUnsuccessfulApiResponse<T extends SocketSdkOperations>(
  _name: T,
  result: SocketSdkErrorType<T>,
  spinner: Spinner
) {
  // SocketSdkErrorType['error'] is not typed.
  const resultErrorMessage = (<{ error?: Error }>result).error?.message
  const message =
    typeof resultErrorMessage === 'string'
      ? resultErrorMessage
      : 'No error message returned'
  if (result.status === 401 || result.status === 403) {
    spinner.stop()
    throw new AuthError(message)
  }
  spinner.error(
    `${colors.bgRed(colors.white('API returned an error:'))} ${message}`
  )
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
    return 'One of the options passed might be incorrect.'
  } else if (code === 403) {
    return 'You might be trying to access an organization that is not linked to the API key you are logged in with.'
  }
}

export async function queryAPI(path: string, apiKey: string) {
  return await fetch(`${API_V0_URL}/${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${btoa(`${apiKey}:${apiKey}`)}`
    }
  })
}
