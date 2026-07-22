#!/usr/bin/env node
// Claude Code PreToolUse hook — prefer-vitest-guard.
//
// Blocks raw test-runner invocations — `node --test <file>` for src/repo tests
// AND any raw `vitest` binary call (bare `vitest` or `node_modules/.bin/vitest`)
// — and steers to the fleet-canonical SCRIPT runner: `pnpm test` (whole suite)
// or `pnpm test <file>` (fast, file-scoped). The bare binary is never run by
// hand: the script owns --config, scope detection, and the single-worker
// pre-commit setting; reaching past it loses all three.
//
// Two test runners by tier:
//   - src / repo unit + integration tests → vitest. `node --test` here runs
//     the Node.js built-in runner whose API surface (`describe`/`it` from
//     `node:test`) differs from vitest's globals, so the files either don't
//     register or silent-pass. This guard blocks that.
//   - the non-vitest tiers → `node --test`. The allow-set is the COMPLEMENT of
//     vitest's discovery: every test dir the fleet vitest config EXCLUDES runs
//     under the Node built-in runner instead, so `node --test` is the
//     sanctioned runner there and blocking it would break the suite. Those
//     dirs (kept in lock-step with .config/repo/vitest.config.mts `exclude`):
//       - `.claude/hooks/**/test/**` — hook tests (run via
//         scripts/repo/run-hook-tests.mts → `pnpm run test:hooks`).
//       - `.config/fleet/oxlint-plugin/**/test/**` — socket/* lint-rule tests.
//       - `scripts/**/test/**` — script-suite tests.
//       - `.git-hooks/**` — git-hook tests.
//       - repo-tunable `nodeTestExclude` globs (see below).
//     A `node --test` whose targets are all in these tiers is ALLOWED.
//
// Also nudges toward targeting a specific file rather than the full suite —
// `pnpm test path/to/foo.test.mts` is faster and scoped to the change in
// flight (test.mts runs `vitest run <file>` for explicit positional paths).
//
// Detection: parses the command string for `node ... --test` (flag anywhere)
// or `node --test` (shorthand). The `node --run` form (pnpm/npm built-in
// script runner) is NOT blocked — that's the fleet-canonical way to invoke
// package.json scripts via the node binary. A `node --test` whose every target
// resolves under a `.claude/hooks/**/test/` path is allowed (hook tier).
//
// Fails open on parse / payload errors.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { commandsFor, parseCommands } from '../_shared/shell-command.mts'

// Pre-flight skip set. The dispatcher imports + runs this guard only when the
// raw command contains one of these substrings. A block can ONLY arise from
// path (a) `node --test` (always carries `--test`), path (b) a bare
// `tsx`/`ts-node` test-file invocation (always carries the binary name), or
// path (c) a raw `vitest` binary call (always carries `vitest`); so a command
// lacking all of these can never block. `tsx` is NOT a substring of `ts-node`,
// so both are listed. `pnpm test` does NOT contain `vitest`, so the sanctioned
// script invocation never trips the pre-flight.
export const triggers: readonly string[] = [
  '--test',
  'ts-node',
  'tsx',
  'vitest',
]

// Repo-tunable node:test homes from the `nodeTestExclude` key of
// .config/{fleet,repo}/vitest.json — the SAME key the vitest config merges into
// its `exclude`. A repo declaring e.g. `tools/**/test/**` there both keeps
// vitest off those suites and lets this guard allow their `node --test` runner;
// the two never drift because they read one key. Fleet + repo arrays concat.
export function readNodeTestExcludeTier(file: string): string[] {
  if (!existsSync(file)) {
    return []
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      nodeTestExclude?: unknown | undefined
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
export function globMatchesTestPath(glob: string, p: string): boolean {
  const re = normalizePath(glob)
    .replace(/[.+^${}()|[\]]/g, '\\$&')
    .replace(/\*\*/g, ' ')
    .replace(/\*/g, '[^/]*')
    .replace(/ /g, '.*')
  return new RegExp(`^${re}$`).test(p)
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
//   - `.config/fleet/oxlint-plugin/<tier>/<rule>/test/` — the socket/* lint-rule
//     tests (e.g. `.config/fleet/oxlint-plugin/fleet/options-null-proto/test/`).
//   - repo-tunable node:test homes from the `nodeTestExclude` key of
//     .config/{fleet,repo}/vitest.json (e.g. socket-lib's `tools/prim/test/**`
//     codemod corpus) — the SAME key vitest merges into its `exclude`, so the
//     allowlist and the skip-list never drift.
// A `node --test` whose targets are all in these tiers is allowed; blocking it
// would break the sanctioned runners. Paths normalized to forward slashes so a
// Windows-style target matches too.
function isNodeTestTierTarget(arg: string): boolean {
  const p = normalizePath(arg)
  if (/(?:^|\/)\.claude\/hooks\/(?:[^/]+\/)+test\//.test(p)) {
    return true
  }
  if (/(?:^|\/)\.config\/fleet\/oxlint-plugin\/(?:[^/]+\/)+test\//.test(p)) {
    return true
  }
  // scripts/**/test/** — script-suite tests (vitest-excluded, run via node --test).
  if (/(?:^|\/)scripts\/(?:[^/]+\/)*test\//.test(p)) {
    return true
  }
  // .git-hooks/** — git-hook tests (vitest-excluded).
  if (/(?:^|\/)\.git-hooks\//.test(p)) {
    return true
  }
  // Repo-owned extra node:test homes (globs like `tools/**/test/**`).
  /* c8 ignore start - module-level cache is [] when no nodeTestExclude config exists in cwd; loop body unreachable without resetting the non-exported cache */
  for (const glob of repoExtraExcludeGlobs()) {
    if (globMatchesTestPath(glob, p)) {
      return true
    }
  }
  /* c8 ignore stop */
  // The cwd-relative canonical form run from inside a hook dir.
  return p === 'test/*.test.mts' || /^test\/[^/]*\.test\.[cm]?[jt]sx?$/.test(p)
}

// The shell-command parser drops bare globs, so the parsed arg list can lose
// the `test/*.test.mts` target. Scan the raw command string for a node-test-
// tier token as a fallback: a `.claude/hooks/<name>/test/` path, a
// `.config/fleet/oxlint-plugin/<tier>/<rule>/test/` path, or the cwd-relative
// `test/*.test.mts` glob. Normalized to forward slashes first.
function commandHasNodeTestTierTarget(command: string): boolean {
  const c = normalizePath(command)
  return (
    /(?:^|[\s'"/])\.claude\/hooks\/(?:[^/]+\/)+test\//.test(c) ||
    /(?:^|[\s'"/])\.config\/fleet\/oxlint-plugin\/(?:[^/]+\/)+test\//.test(c) ||
    /(?:^|[\s'"/])scripts\/(?:[^/]+\/)*test\//.test(c) ||
    /(?:^|[\s'"/])\.git-hooks\//.test(c) ||
    /(?:^|\s)test\/\*\.test\.[cm]?[jt]sx?(?:\s|$|['"])/.test(c)
  )
}

// Vitest subcommands — dropped when extracting file targets from a raw call.
const VITEST_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'bench',
  'list',
  'related',
  'run',
  'watch',
])

// Raw `vitest` / `node_modules/.bin/vitest …` — the bare binary. NEVER a
// sanctioned Claude Bash invocation: src / repo tests run through `pnpm test`
// (whole suite) or `pnpm test <file>` (fast, file-scoped — scripts/fleet/
// test.mts runs `vitest run <file>` for explicit paths), and the node:test
// tiers use `node --test`. The test runner's OWN spawn of node_modules/.bin/
// vitest is a child process, not a Bash tool call, so this never sees it.
// Matched on binary basename via commandsFor, so a path arg merely CONTAINING
// "vitest" (e.g. `--config .config/repo/vitest.config.mts`) does not trip it.
function rawVitestInvocation(command: string): {
  detected: boolean
  testFiles: string[]
} {
  // Match on the BASENAME so the `node_modules/.bin/vitest` path form is caught
  // alongside a bare `vitest` (commandsFor matches the name as-typed, which a
  // path defeats). Same approach as no-direct-linter-guard.
  for (const cmd of parseCommands(command)) {
    if (!cmd.binary) {
      continue
    }
    const base = path.basename(cmd.binary)
    if (base === 'vitest' || base === 'vitest.cmd') {
      const testFiles = cmd.args.filter(
        a => !a.startsWith('-') && !VITEST_SUBCOMMANDS.has(a),
      )
      return { detected: true, testFiles }
    }
  }
  return { detected: false, testFiles: [] }
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

export const check = bashGuard(
  (command): GuardResult => {
    // Path (c): a raw `vitest` binary call — always blocked, steered to the
    // repo script (no node:test-tier exception; raw vitest is never sanctioned).
    const raw = rawVitestInvocation(command)
    if (raw.detected) {
      const suggestion =
        raw.testFiles.length > 0
          ? `pnpm test ${raw.testFiles.join(' ')}`
          : 'pnpm test path/to/your.test.mts'
      return block(
        [
          '[prefer-vitest-guard] Blocked: raw `vitest` binary invocation.',
          '',
          '  Never run vitest directly (bare `vitest` or node_modules/.bin/',
          '  vitest). Src / repo tests go through the repo script, which owns',
          '  the --config, scope, and single-worker pre-commit settings:',
          `    ${suggestion}        (fast, file-scoped)`,
          '    pnpm test                            (the whole suite)',
        ].join('\n'),
      )
    }

    const { detected, testFiles, reason } = isNodeTestCommand(command)
    if (!detected) {
      return undefined
    }

    const suggestion =
      testFiles.length > 0
        ? `pnpm test ${testFiles.join(' ')}`
        : 'pnpm test path/to/your.test.mts'

    const blocked =
      reason === 'node --test'
        ? '`node --test` is the Node.js built-in runner.'
        : reason === 'tsx loader'
          ? '`node --test --import tsx` runs the built-in runner under a TS loader.'
          : '`tsx`/`ts-node` is running a test file directly.'

    return block(
      [
        `[prefer-vitest-guard] Blocked: ${blocked}`,
        '',
        '  Src / repo tests use vitest — never node --test, tsx, or ts-node as',
        '  a test runner. The vitest-excluded tiers DO use node --test:',
        '  .claude/hooks/**/test/, .config/fleet/oxlint-plugin/**/test/,',
        '  scripts/**/test/, .git-hooks/** — those forms are allowed.',
        '  Run the specific test file instead:',
        `    ${suggestion}`,
        '',
        '  Or run the full suite:',
        '    pnpm test',
        '',
        '  Targeting a specific file is faster and scopes coverage to your change.',
      ].join('\n'),
    )
  },
  { fleetOnly: true },
)

export const hook = defineHook({
  bypass: ['node-test-runner'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
