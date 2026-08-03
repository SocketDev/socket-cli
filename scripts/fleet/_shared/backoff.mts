/*
 * @file Escalating-wait primitives shared by fleet scripts that pace, poll,
 *   or retry against rate-limited services (GitHub run deletes, Go proxy
 *   indexing): one event-loop-holding `sleep` and a `createBackoff` state
 *   machine — initial delay, multiply per wait, optional cap, reset on
 *   forward progress.
 */

// The timer must hold the event loop open: with an unref'd timer, a process
// whose only pending work is a paced sleep drains the loop and exits 0
// mid-run — the silent false-green that let workflow-run history pile up
// under the weekly prune cadence for months.
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

export interface BackoffOptions {
  factor?: number | undefined
  maxMs?: number | undefined
  sleeper?: ((ms: number) => Promise<void>) | undefined
}

export interface Backoff {
  currentMs(): number
  reset(): void
  wait(): Promise<void>
}

/**
 * An escalating-wait state machine starting at `ms`: `wait()` sleeps the
 * current delay, then multiplies it by `factor` (default 2) up to `maxMs`;
 * `reset()` returns to `ms` after forward progress. `sleeper` is injectable
 * so tests drive every wait with no real delay.
 */
export function createBackoff(
  ms: number,
  options?: BackoffOptions | undefined,
): Backoff {
  const opts = { __proto__: null, ...options } as BackoffOptions
  const factor = opts.factor ?? 2
  const maxMs = opts.maxMs ?? Number.POSITIVE_INFINITY
  const sleeper = opts.sleeper ?? sleep
  let delayMs = ms
  return {
    currentMs() {
      return delayMs
    },
    reset() {
      delayMs = ms
    },
    async wait() {
      await sleeper(delayMs)
      delayMs = Math.min(delayMs * factor, maxMs)
    },
  }
}
