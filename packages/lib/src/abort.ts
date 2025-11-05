/**
 * @fileoverview Abort signal utilities.
 */

/**
 * Create a composite AbortSignal from multiple signals.
 */
export function createCompositeAbortSignal(
  ...signals: Array<AbortSignal | null | undefined>
): AbortSignal {
  const validSignals = signals.filter(s => s != null) as AbortSignal[]

  if (validSignals.length === 0) {
    return new AbortController().signal
  }

  if (validSignals.length === 1) {
    return validSignals[0]!
  }

  const controller = new AbortController()

  for (const signal of validSignals) {
    if (signal.aborted) {
      controller.abort()
      return controller.signal
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  return controller.signal
}

/**
 * Create an AbortSignal that triggers after a timeout.
 */
export function createTimeoutSignal(ms: number): AbortSignal {
  if (typeof ms !== 'number' || Number.isNaN(ms)) {
    throw new TypeError('timeout must be a number')
  }
  if (!Number.isFinite(ms)) {
    throw new TypeError('timeout must be a finite number')
  }
  if (ms <= 0) {
    throw new TypeError('timeout must be a positive number')
  }
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}
