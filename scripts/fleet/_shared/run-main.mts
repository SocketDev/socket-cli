/**
 * @file Fail-soft entrypoint runner for fleet + repo CLI scripts. Wraps a
 *   script's `main()` so a throw / rejection can NEVER escape as an unhandled
 *   rejection + raw stack trace: the error is surfaced via the logger as a
 *   MESSAGE (never a stack) and the process exits non-zero. `main()` may return
 *   its exit code (or nothing → 0). This replaces the bare `void (async () => {
 *   process.exitCode = await main() })()` entry pattern, which crashes with a
 *   raw stack if `main()` throws. Enforced by
 *   `scripts/fleet/check/entry-scripts-are-fail-soft.mts` (a fleet CLI entry
 *   must fail soft — never hard-crash the user).
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

/**
 * The shape of a script `main()`: it returns an exit code, or nothing
 * (`undefined` / `void` -> exit 0), sync or async.
 */
type MainFn = () =>
  | number
  | undefined
  | void
  | Promise<number | undefined | void>

/**
 * Run a script's `main()` FAIL-SOFT: set `process.exitCode` to its resolved
 * return (`?? 0`), and on ANY throw / rejection log the message (never a raw
 * stack) via the default logger and set `process.exitCode = 1`. Never rethrows,
 * so a fleet CLI can't crash the user with an unhandled stack. Call it inside
 * the entrypoint guard:
 *
 * @example
 *   ;```ts
 *   if (isMainModule(import.meta.url)) {
 *     runMain(main)
 *   }
 *   ```
 */
export function runMain(main: MainFn): void {
  void runMainAsync(main)
}

/**
 * The awaitable core of {@link runMain} — set `process.exitCode` from `main()`'s
 * resolved return (`?? 0`), or on any throw log the message + set exit code 1.
 * Resolves (never rejects). Exported so tests can await the settled result;
 * production entrypoints call the fire-and-forget {@link runMain}.
 */
export async function runMainAsync(main: MainFn): Promise<void> {
  try {
    const code = await main()
    process.exitCode = typeof code === 'number' ? code : 0
  } catch (e) {
    getDefaultLogger().error(errorMessage(e))
    process.exitCode = 1
  }
}
