#!/usr/bin/env node
// Claude Code PreToolUse hook — prefer-vitest-guard.
//
// Blocks `node --test <file>` Bash commands for SRC/REPO tests and steers to
// the fleet-canonical runner (`node_modules/.bin/vitest run <file>` or
// `pnpm test`).
//
// Two test runners by tier:
//   - src / repo unit + integration tests → vitest. `node --test` here runs
//     the Node.js built-in runner whose API surface (`describe`/`it` from
//     `node:test`) differs from vitest's globals, so the files either don't
//     register or silent-pass. This guard blocks that.
//   - hook tests under `.claude/hooks/**/test/` → `node --test`. That IS the
//     canonical hook runner (each hook's package.json declares
//     `"test": "node --test test/*.test.mts"`, run via `pnpm run test:hooks`
//     → scripts/repo/run-hook-tests.mts), because the fleet vitest config
//     excludes `.claude/hooks/**/test/**`. So `node --test` whose targets are
//     all hook-test paths is ALLOWED — blocking it would break the sanctioned
//     hook runner.
//
// Also nudges toward targeting a specific file rather than the full suite —
// `node_modules/.bin/vitest run path/to/foo.test.mts` is faster and scoped to
// the change in flight.
//
// Detection: parses the command string for `node ... --test` (flag anywhere)
// or `node --test` (shorthand). The `node --run` form (pnpm/npm built-in
// script runner) is NOT blocked — that's the fleet-canonical way to invoke
// package.json scripts via the node binary. A `node --test` whose every target
// resolves under a `.claude/hooks/**/test/` path is allowed (hook tier).
//
// Bypass: `Allow node-test-runner bypass` typed verbatim in a recent user
// turn.
//
// Fails open on parse / payload errors.

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'
import { commandsFor } from '../_shared/shell-command.mts'

const BYPASS_PHRASE = 'Allow node-test-runner bypass' as const

// Repo-tunable node:test homes from the `nodeTestExclude` key of
// .config/{fleet,repo}/vitest.json — the SAME key the vitest config merges into
// its `exclude`. A repo declaring e.g. `tools/**/test/**` there both keeps
// vitest off those suites and lets this guard allow their `node --test` runner;
// the two never drift because they read one key. Fleet + repo arrays concat.
function readNodeTestExcludeTier(file: string): string[] {
  if (!existsSync(file)) {
    return []
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      nodeTestExclude?: unknown
    }
    return Array.isArray(parsed?.nodeTestExclude)
      ? parsed.nodeTestExclude.filter(g => typeof g === 'string')
      : []
  } catch {
    return []
  }
}

// Cached read of the resolved node:test-exclude globs (cwd-relative). Returns
// [] when neither tier declares any (fail-open: no extra tiers granted).
let nodeTestExcludeCache: string[] | undefined
function repoExtraExcludeGlobs(): string[] {
  if (nodeTestExcludeCache === undefined) {
    nodeTestExcludeCache = [
      ...readNodeTestExcludeTier('.config/fleet/vitest.json'),
      ...readNodeTestExcludeTier('.config/repo/vitest.json'),
    ]
  }
  return nodeTestExcludeCache
}

// Does a vitest-style exclude glob (e.g. `tools/**/test/**`) cover the test
// path `p`? `**` matches any characters (incl. `/`), `*` matches within a
// segment. `**` is expanded before `*` via a space placeholder so they don't
// collide. Enough for the directory-tier globs this file carries.
function globMatchesTestPath(glob: string, p: string): boolean {
  const re = glob
    .replace(/\\/g, '/')
    .replace(/[.+^${}()|[\]]/g, '\\$&')
    .replace(/\*\*/g, ' ')
    .replace(/\*/g, '[^/]*')
    .replace(/ /g, '.*')
  return new RegExp(`^${re}$`).test(p)
}

interface Payload {
  tool_name?: unknown | undefined
  tool_input?: { command?: unknown | undefined } | undefined
  transcript_path?: unknown | undefined
}

// Matches a test-file path argument (`foo.test.mts`, `bar.spec.ts`, or a
// glob like `test/*.test.mts`).
function looksLikeTestFile(arg: string): boolean {
  return (
    /\.(?:test|spec)\.[cm]?[jt]sx?\b/.test(arg) ||
    /[*?].*\.(?:test|spec)\./.test(arg)
  )
}

// The `node --test` tiers — test dirs the fleet vitest config EXCLUDES, so
// their suites use the Node built-in runner instead of vitest:
//   - `.claude/hooks/<name>/test/` — hook tests (run via
//     scripts/repo/run-hook-tests.mts: `node --test test/*.test.mts`, cwd =
//     the hook dir, so the target is the bare `test/*.test.mts` glob; a direct
//     invocation may spell the full `.claude/hooks/.../test/...` path).
//   - `.config/oxlint-plugin/<tier>/<rule>/test/` — the socket/* lint-rule
//     tests (e.g. `.config/oxlint-plugin/fleet/options-null-proto/test/`).
//   - repo-tunable node:test homes from the `nodeTestExclude` key of
//     .config/{fleet,repo}/vitest.json (e.g. socket-lib's `tools/prim/test/**`
//     codemod corpus) — the SAME key vitest merges into its `exclude`, so the
//     allowlist and the skip-list never drift.
// A `node --test` whose targets are all in these tiers is allowed; blocking it
// would break the sanctioned runners. Paths normalized to forward slashes so a
// Windows-style target matches too.
function isNodeTestTierTarget(arg: string): boolean {
  const p = arg.replace(/\\/g, '/')
  if (/(?:^|\/)\.claude\/hooks\/(?:[^/]+\/)+test\//.test(p)) {
    return true
  }
  if (/(?:^|\/)\.config\/oxlint-plugin\/(?:[^/]+\/)+test\//.test(p)) {
    return true
  }
  // Repo-owned extra node:test homes (globs like `tools/**/test/**`).
  for (const glob of repoExtraExcludeGlobs()) {
    if (globMatchesTestPath(glob, p)) {
      return true
    }
  }
  // The cwd-relative canonical form run from inside a hook dir.
  return p === 'test/*.test.mts' || /^test\/[^/]*\.test\.[cm]?[jt]sx?$/.test(p)
}

// The shell-command parser drops bare globs, so the parsed arg list can lose
// the `test/*.test.mts` target. Scan the raw command string for a node-test-
// tier token as a fallback: a `.claude/hooks/<name>/test/` path, a
// `.config/oxlint-plugin/<tier>/<rule>/test/` path, or the cwd-relative
// `test/*.test.mts` glob. Normalized to forward slashes first.
function commandHasNodeTestTierTarget(command: string): boolean {
  const c = command.replace(/\\/g, '/')
  return (
    /(?:^|[\s'"/])\.claude\/hooks\/(?:[^/]+\/)+test\//.test(c) ||
    /(?:^|[\s'"/])\.config\/oxlint-plugin\/(?:[^/]+\/)+test\//.test(c) ||
    /(?:^|\s)test\/\*\.test\.[cm]?[jt]sx?(?:\s|$|['"])/.test(c)
  )
}

function isNodeTestCommand(command: string): {
  detected: boolean
  testFiles: string[]
  reason: 'node --test' | 'tsx loader' | 'tsx runner'
} {
  // (a) `node --test [--import tsx] <files>` — the built-in runner.
  const nodeCmds = commandsFor(command, 'node')
  for (const { args } of nodeCmds) {
    if (!args.includes('--test')) {
      continue
    }
    const testIdx = args.indexOf('--test')
    const files = args.slice(testIdx + 1).filter(a => !a.startsWith('-'))
    // node-test tier: a `node --test` whose every target resolves under a
    // vitest-excluded test dir (hook tests, oxlint-plugin tests, or the
    // canonical cwd-relative `test/*.test.mts` form) is a sanctioned runner —
    // allow it.
    if (files.length > 0 && files.every(isNodeTestTierTarget)) {
      continue
    }
    // The shell parser drops bare globs (`test/*.test.mts` → no arg), so the
    // file list can come back empty for the canonical invocation. Fall back to
    // scanning the raw command for a node-test-tier target token.
    if (files.length === 0 && commandHasNodeTestTierTarget(command)) {
      continue
    }
    // `--import tsx` / `--loader tsx` on a node --test run is the same
    // anti-pattern wearing a TS loader.
    const usesTsx = args.some(a => a === 'tsx' || a.includes('tsx'))
    return {
      detected: true,
      testFiles: files,
      reason: usesTsx ? 'tsx loader' : 'node --test',
    }
  }
  // (b) bare `tsx <file.test.mts>` / `ts-node <file.test.mts>` — running a
  // test file through a TS loader instead of vitest.
  for (const bin of ['tsx', 'ts-node'] as const) {
    const cmds = commandsFor(command, bin)
    for (const { args } of cmds) {
      const files = args.filter(a => looksLikeTestFile(a))
      if (files.length > 0) {
        return { detected: true, testFiles: files, reason: 'tsx runner' }
      }
    }
  }
  return { detected: false, testFiles: [], reason: 'node --test' }
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

  const { detected, testFiles, reason } = isNodeTestCommand(command)
  if (!detected) {
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

  const suggestion =
    testFiles.length > 0
      ? `node_modules/.bin/vitest run ${testFiles.join(' ')}`
      : 'node_modules/.bin/vitest run path/to/your.test.mts'

  const blocked =
    reason === 'node --test'
      ? '`node --test` is the Node.js built-in runner.'
      : reason === 'tsx loader'
        ? '`node --test --import tsx` runs the built-in runner under a TS loader.'
        : '`tsx`/`ts-node` is running a test file directly.'

  process.stderr.write(
    [
      `[prefer-vitest-guard] Blocked: ${blocked}`,
      '',
      '  Src / repo tests use vitest — never node --test, tsx, or ts-node as',
      '  a test runner. (Hook tests under .claude/hooks/**/test/ DO use',
      '  node --test, via `pnpm run test:hooks` — that form is allowed.)',
      '  Run the specific test file instead:',
      `    ${suggestion}`,
      '',
      '  Or run the full suite:',
      '    pnpm test',
      '',
      '  Targeting a specific file is faster and scopes coverage to your change.',
      '',
      `  Bypass: type "${BYPASS_PHRASE}" to allow it for this invocation.`,
    ].join('\n') + '\n',
  )
  process.exit(2)
}

void main()
