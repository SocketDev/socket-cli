/**
 * Sentry integration for Socket CLI error reporting. Captures exceptions
 * through the internals-gated Sentry client, when one is configured.
 */

import { setTimeout as sleep } from 'node:timers/promises'

import { kInternalsSymbol } from '@socketsecurity/lib-stable/constants/sentinels'
import { debugNs } from '@socketsecurity/lib-stable/debug/output'
import { isError } from '@socketsecurity/lib-stable/errors/predicates'

import { redactSecretsFromText } from '../redact-secrets-from-text.mts'

// Access internals via kInternalsSymbol.
export type SentryClient = {
  captureException(exception: unknown, hint?: unknown | undefined): string
}
const constants = {
  [kInternalsSymbol]: {} as { getSentry?: () => SentryClient | undefined },
}
const internals = constants[kInternalsSymbol]
const getSentry = internals?.getSentry

export type EventHintOrCaptureContext = { [key: string]: unknown } | Function

// Matches the cause-walk depth in error/display.mts so a deeply nested chain
// cannot spin here.
const MAX_CAUSE_DEPTH = 5

export async function captureException(
  exception: unknown,
  hint?: EventHintOrCaptureContext | undefined,
): Promise<string> {
  const result = captureExceptionSync(exception, hint)
  // "Sleep" for a second, just in case, hopefully enough time to initiate fetch.
  await sleep(1000)
  return result
}

export function captureExceptionSync(
  exception: unknown,
  hint?: EventHintOrCaptureContext | undefined,
): string {
  const Sentry = getSentry?.()
  if (!Sentry) {
    return ''
  }
  /* c8 ignore start - Sentry is undefined in tests, Sentry build mode is opt-in only*/
  debugNs('notice', 'send: exception to Sentry')
  return Sentry.captureException(redactExceptionForCapture(exception), hint)
  /* c8 ignore stop */
}

/**
 * Strip credentials from an exception before it leaves the machine.
 *
 * Sentry serializes `message`, `stack`, and the `cause` chain, and any of the
 * three can carry a request URL with a query token or a spawn command line with
 * an API token in it. Returns a copy so the caller's error object — which the
 * terminal path may still print — is left alone.
 *
 * @param exception - The thrown value about to be captured.
 * @param depth - Current position in the cause chain.
 *
 * @returns The exception with every credential shape replaced.
 */
export function redactExceptionForCapture(
  exception: unknown,
  depth = 0,
): unknown {
  if (typeof exception === 'string') {
    return redactSecretsFromText(exception)
  }
  if (!isError(exception) || depth >= MAX_CAUSE_DEPTH) {
    return exception
  }
  const copy = Object.create(
    Object.getPrototypeOf(exception),
    Object.getOwnPropertyDescriptors(exception),
  ) as Error
  // Define rather than assign. V8 installs `stack` as an own accessor whose
  // getter returns undefined for any receiver other than the error it was
  // created for, so a copied descriptor plus a plain assignment yields an
  // error with no stack at all.
  const redefine = { configurable: true, enumerable: false, writable: true }
  Object.defineProperty(copy, 'message', {
    ...redefine,
    value: redactSecretsFromText(exception.message),
  })
  if (exception.stack !== undefined) {
    Object.defineProperty(copy, 'stack', {
      ...redefine,
      value: redactSecretsFromText(exception.stack),
    })
  }
  if (exception.cause !== undefined) {
    Object.defineProperty(copy, 'cause', {
      ...redefine,
      value: redactExceptionForCapture(exception.cause, depth + 1),
    })
  }
  return copy
}
