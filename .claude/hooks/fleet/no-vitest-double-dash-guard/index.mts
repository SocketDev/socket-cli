#!/usr/bin/env node
// Claude Code PreToolUse hook — no-vitest-double-dash-guard.
//
// Blocks a vitest invocation that puts `--` before the test-file path, e.g.
//   pnpm test -- test/foo.test.mts
//   pnpm run test -- path/to/foo.test.mts
//   node_modules/.bin/vitest run -- foo.test.mts
//
// Why: the `--` is swallowed by the script runner (pnpm/npm) as its
// args-separator, so vitest receives NO positional filter and runs the ENTIRE
// suite instead of the one file. In a fleet repo the full suite can be minutes
// (and in a few repos sweeps .claude/hooks tests and hangs). The intent is
// always "run this one file" — the `--` silently defeats it. Drop the `--`:
//   pnpm test test/foo.test.mts        (pnpm forwards positionals fine)
//   node_modules/.bin/vitest run test/foo.test.mts
//
// Detection is AST-based (the fleet shell parser via parseCommands), not regex,
// per no-command-regex-in-hooks-guard. Matches a vitest binary directly, or a
// pnpm/npm/yarn `test`/`run test` script invocation, then flags a `--` token
// that is followed by a non-flag positional (the path the user meant to scope
// to).
//
// Bypass: `Allow vitest-double-dash bypass` typed verbatim in a recent turn.
//
// Fails open on parse / payload errors.

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { parseCommands } from '../_shared/shell-command.mts'

// Pre-flight triggers: the dispatcher skips importing this guard unless the
// raw payload contains one of these substrings. Every blocking path requires
// BOTH a `--` token AND a matched binary — either `vitest`
// (`vitest`/`node_modules/.bin/vitest`) or a `pnpm`/`npm`/`yarn` `test` script
// runner — so a command naming none of these binaries can never block. (`npm`
// is also a substring of `pnpm`; both are listed for clarity.)
export const triggers: readonly string[] = ['npm', 'pnpm', 'vitest', 'yarn']

// A vitest binary path (bare `vitest` or `node_modules/.bin/vitest`).
function isVitestBinary(binary: string): boolean {
  return binary === 'vitest' || /(?:^|\/)vitest$/.test(binary)
}

// A pnpm/npm/yarn invocation of the `test` script (which wraps vitest):
//   pnpm test … | pnpm run test … | npm test … | yarn test …
function isTestScriptRunner(binary: string, args: readonly string[]): boolean {
  if (binary !== 'npm' && binary !== 'pnpm' && binary !== 'yarn') {
    return false
  }
  const positionals = args.filter(a => !a.startsWith('-'))
  if (positionals[0] === 'test') {
    return true
  }
  if (
    (positionals[0] === 'run' || positionals[0] === 'run-script') &&
    positionals[1] === 'test'
  ) {
    return true
  }
  return false
}

// True when a `--` token is followed by at least one non-flag positional —
// the path the caller meant to scope vitest to, which the `--` instead drops.
function dashDashPrecedesPath(args: readonly string[]): boolean {
  const idx = args.indexOf('--')
  if (idx === -1) {
    return false
  }
  return args.slice(idx + 1).some(a => !a.startsWith('-'))
}

// The offending command's binary, or undefined when clean. Pure — the test
// drives it directly.
export function vitestDoubleDash(command: string): string | undefined {
  let commands
  try {
    commands = parseCommands(command)
  } catch {
    /* c8 ignore start - parseCommands has its own try/catch and never throws; this is a defensive fallback */
    return undefined
    /* c8 ignore stop */
  }
  for (let i = 0, { length } = commands; i < length; i += 1) {
    const { binary, args } = commands[i]!
    if (!isVitestBinary(binary) && !isTestScriptRunner(binary, args)) {
      continue
    }
    if (dashDashPrecedesPath(args)) {
      return binary
    }
  }
  return undefined
}

export const check = bashGuard(command => {
  if (!command.trim()) {
    return undefined
  }

  const offender = vitestDoubleDash(command)
  if (!offender) {
    return undefined
  }

  return block(
    [
      '[no-vitest-double-dash-guard] Blocked: `--` before a vitest test path.',
      '',
      `  The \`--\` after \`${offender}\` is swallowed by the script runner, so`,
      '  vitest gets NO positional filter and runs the ENTIRE suite — not the',
      '  one file you targeted (slow; in some repos it sweeps .claude/hooks and',
      '  hangs).',
      '',
      '  Drop the `--` — the positional path is forwarded fine without it:',
      '    pnpm test test/foo.test.mts',
      '    node_modules/.bin/vitest run test/foo.test.mts',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['vitest-double-dash'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
