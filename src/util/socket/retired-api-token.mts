import crypto from 'node:crypto'

import type { CResult } from '../../types.mts'

const RETIRED_SOCKET_API_TOKEN_SHA256 =
  '9cab58b24140ee12c08e265729d246f9200f8ef9b1d884f90c06c4e6b69adf18'
const RETIRED_SOCKET_API_TOKEN_MESSAGE =
  'The selected Socket API token is retired. Replace it or unset SOCKET_CLI_API_TOKEN / SOCKET_SECURITY_API_KEY if an environment variable supplies it, then use `socket login` or `socket config set apiToken`.'

export class RetiredSocketApiTokenError extends Error {
  readonly code = 'SOCKET_RETIRED_API_TOKEN'

  constructor() {
    super(RETIRED_SOCKET_API_TOKEN_MESSAGE)
    this.name = 'RetiredSocketApiTokenError'
  }
}

export function createRetiredSocketApiTokenFailure<T>(): CResult<T> {
  return {
    ok: false,
    message: 'Authentication Error',
    cause: RETIRED_SOCKET_API_TOKEN_MESSAGE,
  }
}

export function isRetiredSocketApiToken(value: string | undefined): boolean {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false
  }
  const digest = crypto.createHash('sha256').update(value.trim()).digest('hex')
  return digest === RETIRED_SOCKET_API_TOKEN_SHA256
}

export function retiredSocketApiTokenFailure(
  error: unknown,
): CResult<never> | undefined {
  if (!(error instanceof RetiredSocketApiTokenError)) {
    return undefined
  }
  return {
    ok: false,
    message: 'Authentication Error',
    cause: error.message,
  }
}

export function throwIfRetiredSocketApiToken(value: string | undefined): void {
  if (isRetiredSocketApiToken(value)) {
    throw new RetiredSocketApiTokenError()
  }
}
