import { setTimeout as wait } from 'node:timers/promises'

import { debugLog } from './debug'
import constants from '../constants'

const {
  kInternalsSymbol,
  [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: { getSentry }
} = constants

type EventHintOrCaptureContext = { [key: string]: any } | Function

export class AuthError extends Error {}

export class InputError extends Error {
  public body: string | undefined

  constructor(message: string, body?: string) {
    super(message)
    this.body = body
  }
}

export async function captureException(
  exception: unknown,
  hint?: EventHintOrCaptureContext | undefined
): Promise<string> {
  const result = captureExceptionSync(exception, hint)
  // "Sleep" for a second, just in case, hopefully enough time to initiate fetch.
  await wait(1000)
  return result
}

export function captureExceptionSync(
  exception: unknown,
  hint?: EventHintOrCaptureContext | undefined
): string {
  const Sentry = getSentry()
  if (!Sentry) {
    return ''
  }
  debugLog('captureException: Sending exception to Sentry.')
  return <string>Sentry.captureException(exception, hint)
}

export function isErrnoException(
  value: unknown
): value is NodeJS.ErrnoException {
  if (!(value instanceof Error)) {
    return false
  }
  return (value as NodeJS.ErrnoException).code !== undefined
}
