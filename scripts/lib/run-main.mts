/**
 * @file Fail-soft entrypoint runner for the socket-cli scripts. Wraps a
 *   script's `main()` so a throw or rejection can never escape as an unhandled
 *   rejection plus a raw stack trace: the error is surfaced as a MESSAGE on
 *   stderr and the process exits non-zero. `main()` may return its exit code,
 *   or nothing for 0.
 *
 *   It also owns the whole-argv concerns every entry script shares, so a new
 *   script inherits them instead of having to remember each one:
 *
 *     --describe      print the script's one-line purpose
 *     -h, --help      print that one-liner plus the usage body
 *     --              refused, because the argv parser truncates there
 *
 *   All three are answered BEFORE `main()` runs, so `--describe` can never
 *   trigger the script's side effect. That ordering is the whole point: a
 *   `--describe` that reaches `main()` on an update script performs a real
 *   dependency update, which is exactly the bug this file exists to prevent.
 *   For the same reason a script must not do work at module scope — put it in
 *   `main()`, and call `runMain()` behind an `isMainModule()` guard.
 *
 *   This is a self-contained vendored copy: it imports only `node:` builtins so
 *   it can run before `pnpm install` and in any CI stage.
 */

import process from 'node:process'

/**
 * A script's self-description, answered without running its side effect.
 * `--describe` prints `describe` verbatim — one line, what the script does — so
 * script inventories and agents can read a script's purpose without opening the
 * file. `-h`/`--help` prints `describe`, a blank line, then `help`, which opens
 * with a `Usage:` line naming the sanctioned invocation and lists the flags
 * `main()` actually parses.
 */
export interface ScriptMeta {
  readonly describe: string
  readonly help: string
}

/**
 * The shape of a script `main()`: it returns an exit code, or nothing
 * (`undefined`/`void` for exit 0), sync or async.
 */
export type MainFn = () =>
  | number
  | undefined
  | void
  | Promise<number | undefined | void>

/**
 * True when argv carries a bare `--`.
 *
 * `pnpm run <script> -- --flag` forwards the `--` to the script, and the argv
 * parser truncates there — every flag after it is DISCARDED, not collected as a
 * positional. The script then runs with its default behaviour while the caller
 * believes they passed flags. That is merely confusing for a read-only script
 * and dangerous for a mutating one: `update -- --dry-run` would drop the
 * `--dry-run` and perform a live update.
 */
export function hasBareDoubleDash(argv: readonly string[]): boolean {
  return argv.includes('--')
}

/**
 * The package.json script name for an entry path — its basename without the
 * extension, so the suggested fix (`pnpm run update --dry-run`) is something
 * the caller can paste rather than a file path. Pure — exported for tests.
 */
export function scriptNameFromEntry(entryPath: string | undefined): string {
  if (!entryPath) {
    return 'this script'
  }
  const basename = entryPath.replaceAll('\\', '/').split('/').pop() ?? ''
  return basename.replace(/\.[cm]?[jt]s$/, '') || 'this script'
}

/**
 * The message shown when argv carries a bare `--`. Names the script so the
 * corrected command can be pasted directly.
 */
export function bareDoubleDashMessage(scriptName: string): string {
  return (
    'a bare `--` in the command line\n' +
    `  Where: the argv for ${scriptName}.\n` +
    '  Saw: flags after `--`. The argv parser truncates there, so those flags ' +
    'were NOT applied and the script ran with its defaults.\n' +
    `  Fix: drop the \`--\`, e.g. \`pnpm run ${scriptName} --dry-run\`.`
  )
}

/**
 * The help request found on argv, if any. `--describe` wins over `-h`/`--help`
 * when both are present: the narrower ask costs one line, and printing both
 * forms for a mixed argv helps no caller. Pure — exported for tests.
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
 * The text a help request prints: the one-liner alone for `--describe`, or the
 * one-liner plus a blank line plus the usage body for `--help`. Pure —
 * exported for tests.
 */
export function helpText(kind: 'describe' | 'help', meta: ScriptMeta): string {
  return kind === 'describe'
    ? meta.describe
    : `${meta.describe}\n\n${meta.help}`
}

/**
 * The message text for a thrown value, never its stack. A script's failure
 * should read like a sentence, not a crash dump.
 */
export function scriptErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message || String(e)
  }
  return String(e)
}

/**
 * Run a script's `main()` fail-soft: set `process.exitCode` to its resolved
 * return (or 0), and on any throw or rejection print the message — never a raw
 * stack — and set `process.exitCode = 1`. Never rethrows, so a script can't
 * crash the caller with an unhandled stack. Call it inside the entrypoint
 * guard:
 *
 * @example
 *   if (isMainModule(import.meta.url)) {
 *     runMain(main, SCRIPT_META)
 *   }
 */
export function runMain(main: MainFn, meta?: ScriptMeta | undefined): void {
  void runMainAsync(main, meta)
}

/**
 * The awaitable core of {@link runMain}. Resolves, never rejects. Exported so
 * tests can await the settled result; production entrypoints call the
 * fire-and-forget {@link runMain}.
 */
export async function runMainAsync(
  main: MainFn,
  meta?: ScriptMeta | undefined,
  argvOverride?: readonly string[] | undefined,
): Promise<void> {
  const argv = argvOverride ?? process.argv.slice(2)
  if (meta) {
    // Answered before the bare-`--` refusal and before main(): a help request
    // must succeed even on an argv the script would otherwise refuse, and it
    // must never reach the script's side effect.
    const request = helpRequest(argv)
    if (request) {
      process.stdout.write(`${helpText(request, meta)}\n`)
      process.exitCode = 0
      return
    }
  }
  if (hasBareDoubleDash(argv)) {
    // Refuse rather than guess. Silently dropping flags fails OPEN, which for a
    // mutating script means running live when a preview was requested.
    process.stderr.write(
      `${bareDoubleDashMessage(scriptNameFromEntry(process.argv[1]))}\n`,
    )
    process.exitCode = 1
    return
  }
  try {
    const code = await main()
    if (typeof code === 'number') {
      process.exitCode = code
    } else if (!process.exitCode) {
      // Only default to 0 when nothing has claimed a code. A `main(): void` can
      // signal failure the other sanctioned way — assign `process.exitCode`,
      // then return — and unconditionally writing 0 here would turn that into a
      // silent green: the script prints its failure and still exits 0, so every
      // caller gating on the exit status reads success.
      process.exitCode = 0
    }
  } catch (e) {
    process.stderr.write(`${scriptErrorMessage(e)}\n`)
    process.exitCode = 1
  }
}
