/**
 * @file Fleet-canonical Windows-tolerant timing helpers for tests. Pure
 *   functions and constants — no `it` / `describe` imports — so any test runner
 *   (vitest, node:test, jest) can adopt them. Pairs with `./platform.mts`
 *   (platform predicates) and `./tags.mts` (title prefixes). The
 *   runner-specific wrappers (`itFlaky`, `describeFlaky`, etc.) live in the
 *   per-repo `test/util/skip-helpers.mts` and call into this module.
 */
import { WIN32 } from './platform.mts'

/**
 * Tolerance multiplier applied to timeouts and sleep budgets on Windows.
 * GitHub-hosted `windows-latest` runners have:
 *
 * - Coarser timer granularity (15.6 ms default tick vs 1 ms on Linux).
 * - Higher worker-dispatch overhead under vitest pool contention (observed spikes
 *   up to ~2 s).
 * - File-system mtime caching that delays cache-expiry observations.
 *
 * Most timing-sensitive tests pass on Unix at 1× but flake on Windows at < 5×.
 */
export const TIMEOUT_MULTIPLIER: number = 5

/**
 * Minimum observable timer quantum on the current platform, in milliseconds.
 * Windows defaults to ~15.6 ms (one tick of the system timer); Unix-likes
 * resolve down to ~1 ms. Tests asserting on `Date.now()` deltas or sleeping for
 * less than this value will see the lower bound clip on Windows — compare
 * assertions against `Math.max(expected, MIN_TIMER_QUANTUM_MS)`.
 */
export const MIN_TIMER_QUANTUM_MS: number = WIN32 ? 15.6 : 1

/**
 * Returns `ms` on non-Windows, `ms * TIMEOUT_MULTIPLIER` on Windows. Apply to
 * per-test timeouts, sleep budgets, and any assertion window historically known
 * to flake on Windows.
 *
 * @example
 *   ;```ts
 *   import { tolerantTimeout } from '../../fleet/_shared/lib/timing.mts'
 *
 *   // 5s budget on Unix, 25s on Windows.
 *   it('should expire entries after TTL', async () => {
 *     // ...
 *   }, tolerantTimeout(5_000))
 *   ```
 */
export function tolerantTimeout(ms: number): number {
  return WIN32 ? ms * TIMEOUT_MULTIPLIER : ms
}

/**
 * Alias of {@link tolerantTimeout} named for the "sleep N before observation"
 * shape — TTL expiry, debounce flush, retry back-off — so the call site reads
 * naturally.
 *
 * @example
 *   ;```ts
 *   await new Promise(r => setTimeout(r, tolerantSleep(100)))
 *   ```
 */
export function tolerantSleep(ms: number): number {
  return tolerantTimeout(ms)
}

/**
 * Lower-bound a sleep budget at the platform timer quantum. A test's "small
 * delay" of 10-20 ms silently stretches to ~16 ms on Windows;
 * `minTimerQuantum(20)` returns 20 ms on both (already above the quantum), but
 * `minTimerQuantum(5)` returns 15.6 ms on Windows so the sleep matches the
 * assertion budget.
 *
 * @example
 *   ;```ts
 *   await new Promise(r => setTimeout(r, minTimerQuantum(5)))
 *   ```
 */
export function minTimerQuantum(ms: number): number {
  return Math.max(ms, MIN_TIMER_QUANTUM_MS)
}
