/**
 * @file Fail-soft entrypoint runner for fleet + repo CLI scripts. Wraps a
 *   script's `main()` so a throw / rejection can NEVER escape as an unhandled
 *   rejection + raw stack trace: the error is surfaced via the logger as a
 *   MESSAGE, never a stack, and the process exits non-zero. `main()` may return
 *   its exit code (or nothing → 0). This replaces the bare `void (async () => {
 *   process.exitCode = await main() })()` entry pattern, which crashes with a
 *   raw stack if `main()` throws. Enforced by
 *   `scripts/fleet/check/entry-scripts-are-fail-soft.mts` (a fleet CLI entry
 *   must fail soft — never hard-crash the user).
 *   It also refuses a bare `--` in argv before `main()` runs. That belongs here
 *   rather than in each script: it is a whole-argv property, every fleet entry
 *   has the same exposure, and one home means a new script inherits the
 *   protection instead of having to remember it.
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

/**
 * True when argv carries a bare `--`.
 *
 * `pnpm run <script> -- --flag` forwards the `--` to the script, and the argv
 * parser truncates there — every flag after it is DISCARDED, not collected as a
 * positional. The script then runs with default behaviour while the caller
 * believes they passed flags. That is merely confusing for a read-only script
 * and dangerous for a destructive one: `prune-backups -- --dry-run` drops the
 * `--dry-run` and performs a live run against every repo.
 *
 * Checked against `process.argv` because by the time parsing finishes the
 * dropped flags are unrecoverable — the parsed result cannot tell you what was
 * lost.
 */
export function hasBareDoubleDash(argv: readonly string[]): boolean {
  return argv.includes('--')
}

/**
 * The message shown when argv carries a bare `--`. Names the script so the
 * corrected command can be pasted directly.
 */
export function bareDoubleDashMessage(scriptName: string): string {
  return (
    'a bare `--` in the command line\n' +
    `  Where: the argv for ${scriptName}.\n` +
    '  Saw:   flags after `--`. The argv parser truncates there, so those ' +
    'flags were NOT applied and the script ran with its defaults.\n' +
    `  Fix:   drop the \`--\`, e.g. \`pnpm run ${scriptName} --dry-run\`.`
  )
}

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
 * Resolves, never rejects. Exported so tests can await the settled result;
 * production entrypoints call the fire-and-forget {@link runMain}.
 */
export async function runMainAsync(main: MainFn): Promise<void> {
  const argv = process.argv.slice(2)
  if (hasBareDoubleDash(argv)) {
    // Refuse rather than guess. Silently dropping flags fails OPEN, which for a
    // destructive script means running live when a preview was requested.
    const scriptName = process.argv[1]?.split('/').pop() ?? 'this script'
    logger.error(bareDoubleDashMessage(scriptName))
    process.exitCode = 1
    return
  }
  try {
    const code = await main()
    process.exitCode = typeof code === 'number' ? code : 0
  } catch (e) {
    logger.error(errorMessage(e))
    process.exitCode = 1
  }
}
