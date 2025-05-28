import { setTimeout as wait } from 'node:timers/promises'

import { debugFn } from '@socketsecurity/registry/lib/debug'

import constants from '../constants.mts'

const {
  kInternalsSymbol,
  [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: { getSentry },
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
  hint?: EventHintOrCaptureContext | undefined,
): Promise<string> {
  const result = captureExceptionSync(exception, hint)
  // "Sleep" for a second, just in case, hopefully enough time to initiate fetch.
  await wait(1000)
  return result
}

export function captureExceptionSync(
  exception: unknown,
  hint?: EventHintOrCaptureContext | undefined,
): string {
  const Sentry = getSentry()
  if (!Sentry) {
    return ''
  }
  debugFn(captureException, `Sending exception to Sentry.`)
  return Sentry.captureException(exception, hint) as string
}

export function isErrnoException(
  value: unknown,
): value is NodeJS.ErrnoException {
  if (!(value instanceof Error)) {
    return false
  }
  return (value as NodeJS.ErrnoException).code !== undefined
}
