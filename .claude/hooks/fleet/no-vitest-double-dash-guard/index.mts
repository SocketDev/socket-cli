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

import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'
import { parseCommands } from '../_shared/shell-command.mts'

const BYPASS_PHRASE = 'Allow vitest-double-dash bypass' as const

interface Payload {
  tool_name?: unknown | undefined
  tool_input?: { command?: unknown | undefined } | undefined
  transcript_path?: unknown | undefined
}

// A vitest binary path (bare `vitest` or `node_modules/.bin/vitest`).
function isVitestBinary(binary: string): boolean {
  return binary === 'vitest' || /(?:^|\/)vitest$/.test(binary)
}

// A pnpm/npm/yarn invocation of the `test` script (which wraps vitest):
//   pnpm test … | pnpm run test … | npm test … | yarn test …
function isTestScriptRunner(binary: string, args: readonly string[]): boolean {
  if (binary !== 'pnpm' && binary !== 'npm' && binary !== 'yarn') {
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
    return undefined
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

async function main(): Promise<void> {
  const raw = await readStdin()
  let payload: Payload
  try {
    payload = JSON.parse(raw) as Payload
  } catch {
    process.exit(0)
  }
  if (payload.tool_name !== 'Bash') {
    process.exit(0)
  }
  const command =
    typeof payload.tool_input?.command === 'string'
      ? payload.tool_input.command
      : ''
  if (!command.trim()) {
    process.exit(0)
  }

  const offender = vitestDoubleDash(command)
  if (!offender) {
    process.exit(0)
  }

  const transcriptPath =
    typeof payload.transcript_path === 'string'
      ? payload.transcript_path
      : undefined
  if (
    transcriptPath &&
    bypassPhrasePresent(transcriptPath, [BYPASS_PHRASE], 3)
  ) {
    process.exit(0)
  }

  process.stderr.write(
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
      '',
      `  Bypass: type "${BYPASS_PHRASE}" to allow this invocation.`,
    ].join('\n') + '\n',
  )
  process.exit(2)
}

if (process.argv[1]?.endsWith('index.mts')) {
  // Async IIFE: await inside the function (no top-level await — CJS bundle
  // target), promise still awaited. Fails open on any throw.
  void (async () => {
    try {
      await main()
    } catch {
      process.exit(0)
    }
  })()
}
