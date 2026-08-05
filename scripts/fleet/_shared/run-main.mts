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
 *   It also owns the whole-argv concerns every entry shares, so a new script
 *   inherits them instead of having to remember each: `--describe` prints the
 *   script's one-line purpose, `-h`/`--help` prints its usage (both from the
 *   {@link ScriptMeta} the entry passes, both BEFORE `main()` runs or any lock
 *   is taken), and a bare `--` in argv is refused before `main()` runs.
 *   Enforced by `scripts/fleet/check/entry-scripts-self-describe.mts` (every
 *   entry script answers --describe and --help without running its side
 *   effect).
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
 * and dangerous for a destructive one: `prune:backups -- --dry-run` drops the
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
 * A script's self-description, answered without running its side effect.
 * `--describe` prints `describe` verbatim — one line, what the script does —
 * so script inventories and agents can read purpose without opening the file.
 * `-h`/`--help` prints `describe`, a blank line, then `help`, which opens
 * with a `Usage:` line naming the sanctioned invocation and lists the flags
 * `main()` actually parses.
 */
export interface ScriptMeta {
  readonly describe: string
  readonly help: string
}

/**
 * The help request found on argv, if any: `--describe` wins over `-h`/`--help`
 * when both are present (the narrower ask costs one line; printing both forms
 * for a mixed argv helps no caller). Pure — exported for tests.
 */
export function helpRequest(
  argv: readonly string[],
): 'describe' | 'help' | undefined {
  if (argv.includes('--describe')) {
    return 'describe'
  }
  if (argv.includes('-h') || argv.includes('--help')) {
    return 'help'
  }
  return undefined
}

/**
 * The text a help request prints: the one-liner alone for `--describe`, or
 * the one-liner + blank line + usage body for `--help`. Pure — exported for
 * tests.
 */
export function helpText(kind: 'describe' | 'help', meta: ScriptMeta): string {
  return kind === 'describe'
    ? meta.describe
    : `${meta.describe}\n\n${meta.help}`
}

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
export function runMain(main: MainFn, meta?: ScriptMeta | undefined): void {
  void runMainAsync(main, meta)
}

/**
 * The awaitable core of {@link runMain} — set `process.exitCode` from `main()`'s
 * resolved return, or on any throw log the message + set exit code 1. A
 * `main()` that returns no number keeps whatever code it assigned itself, and
 * only an unclaimed code defaults to 0. Resolves, never rejects. Exported so
 * tests can await the settled result; production entrypoints call the
 * fire-and-forget {@link runMain}.
 */
export async function runMainAsync(
  main: MainFn,
  meta?: ScriptMeta | undefined,
): Promise<void> {
  const argv = process.argv.slice(2)
  if (meta) {
    // Answered before the bare-`--` refusal, before any lock, before main():
    // a help request must succeed even on an argv the script would refuse,
    // and while another holder has the repo lock.
    const request = helpRequest(argv)
    if (request) {
      logger.log(helpText(request, meta))
      process.exitCode = 0
      return
    }
  }
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
    if (typeof code === 'number') {
      process.exitCode = code
    } else if (!process.exitCode) {
      // Only default to 0 when nothing has claimed a code. A `main(): void`
      // signals failure the other sanctioned way — assign `process.exitCode`,
      // then return — and unconditionally writing 0 here turned that into a
      // SILENT GREEN: the script printed its failure and still exited 0, so
      // every caller gating on the exit status read success. That is the
      // false-green `code-first-then-ai` forbids, and it reached
      // `pre-push-gate.mts`, which prints "RED — nothing pushed" and exited 0.
      process.exitCode = 0
    }
  } catch (e) {
    logger.error(errorMessage(e))
    process.exitCode = 1
  }
}
