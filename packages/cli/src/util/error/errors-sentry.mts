/**
 * Sentry integration for Socket CLI error reporting. Captures exceptions
 * through the internals-gated Sentry client, when one is configured.
 */

import { setTimeout as sleep } from 'node:timers/promises'

import { kInternalsSymbol } from '@socketsecurity/lib-stable/constants/sentinels'
import { debugNs } from '@socketsecurity/lib-stable/debug/output'

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
  /* c8 ignore start - Sentry is undefined in tests (Sentry build mode is opt-in only) */
  debugNs('notice', 'send: exception to Sentry')
  return Sentry.captureException(exception, hint)
  /* c8 ignore stop */
}
