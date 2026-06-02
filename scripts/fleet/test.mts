/* eslint-disable no-shadow -- nested cached-length for-loops intentionally reuse `i`/`length` names for the fleet-wide cached-loop idiom; renaming would diverge from the codebase pattern. */
/**
 * @file Canonical minimal test runner for socket-* repos. Delegates the
 *   scope-to-tests mapping to vitest itself rather than rolling a basename-
 *   based mapper that would inevitably drift from the actual module graph.
 *   Scope modes:
 *
 *   - `(default)` — local-dev scope. Runs `vitest --changed`, vitest's
 *     compare-vs-HEAD-with-uncommitted mode. Walks the actual import graph so a
 *     change to a util shared by many tests runs every affected test file, not
 *     the union of two guesses.
 *   - `--staged` — pre-commit hook scope. Hands `git diff --cached` filenames to
 *     `vitest related <files…> --run`. Same module-graph walk, but rooted at
 *     the staged delta. The `--run` flag is mandatory: `vitest related`
 *     defaults to watch mode just like the bare `vitest` invocation, which
 *     would hang the pre-commit hook.
 *   - `--all` — run the full suite (`vitest run`). Used in CI and on explicit
 *     opt-in. Flags: `--quiet` / `--silent` suppress progress output. Config /
 *     infrastructure changes (`vitest.config*`, `tsconfig*`, `.oxlintrc.json`,
 *     `.oxfmtrc.json`, `pnpm-lock.yaml`, `package.json`, anything under
 *     `.config/` or `scripts/`) still escalate to `all` — module-graph
 *     traversal doesn't capture config-derived discovery + alias changes. See
 *     https://vitest.dev/guide/cli.html#vitest-related.
 */

// prefer-async-spawn: sync-required — top-level CLI runner; entire
// flow is sync (test runner invocation + exit-code aggregation).
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import type { SpawnSyncOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import process from 'node:process'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

// The fleet-canonical vitest config lives at .config/repo/vitest.config.mts in
// single-package repos. A monorepo may have no root config — its configs live
// per package (packages/<pkg>/vitest.config.mts). Only pass `--config` when the
// root config actually exists; otherwise let vitest discover (per-package
// configs in a monorepo, or its own default). Hard-coding the flag broke
// `pnpm test` in monorepos with no root config (UNRESOLVED_ENTRY).
const ROOT_VITEST_CONFIG = '.config/repo/vitest.config.mts'

const args = process.argv.slice(2)
const mode: 'staged' | 'all' | 'modified' = args.includes('--all')
  ? 'all'
  : args.includes('--staged')
    ? 'staged'
    : 'modified'
const quiet = args.includes('--quiet') || args.includes('--silent')
const stdio: SpawnSyncOptions['stdio'] = quiet ? 'pipe' : 'inherit'
// On Windows, `pnpm` is a .cmd shim that Node refuses to exec directly via
// spawnSync (CVE-2024-27980 hardening). Wrap through the shell on Windows
// only; POSIX keeps direct invocation.
const useShell = process.platform === 'win32'

// Paths that, when changed, force the full suite to run.
const ESCALATION_PATTERNS = [
  /^\.config\//,
  /^scripts\//,
  /^pnpm-lock\.yaml$/,
  /^tsconfig.*\.json$/,
  /^\.oxlintrc\.json$/,
  /^\.oxfmtrc\.json$/,
  /^vitest\.config\.(?:js|mjs|mts|ts)$/,
  /^package\.json$/,
  /^lockstep\.schema\.json$/,
]

function log(msg: string): void {
  if (!quiet) {
    logger.log(msg)
  }
}

function gitFiles(args: string[]): string[] {
  // spawnSync with array args — no shell interpolation. Matches the
  // socket/prefer-spawn-over-execsync rule contract.
  const r = spawnSync('git', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return []
  }
  return r.stdout
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

function getStagedFiles(): string[] {
  return gitFiles(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
}

function getModifiedFiles(): string[] {
  return gitFiles(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'])
}

function shouldEscalate(files: string[]): boolean {
  for (let i = 0, { length } = files; i < length; i += 1) {
    const f = files[i]!
    for (let i = 0, { length } = ESCALATION_PATTERNS; i < length; i += 1) {
      const pattern = ESCALATION_PATTERNS[i]!
      if (pattern.test(f)) {
        return true
      }
    }
  }
  return false
}

function runVitest(vitestArgs: string[], label: string): number {
  log(`Test scope: ${label}`)
  const configArgs = existsSync(ROOT_VITEST_CONFIG)
    ? ['--config', ROOT_VITEST_CONFIG]
    : []
  const r = spawnSync(
    'pnpm',
    ['exec', 'vitest', ...vitestArgs, ...configArgs],
    // Windows shell-shim rationale: see useShell at file top.
    { shell: useShell, stdio },
  )
  if (r.status !== 0) {
    log('Tests failed')
    return 1
  }
  log('All tests passed')
  return 0
}

function runAll(): number {
  return runVitest(['run'], 'all')
}

// --passWithNoTests: a scoped run where the changed files don't resolve
// to any test file should succeed rather than error with "No test files
// found". Keeps pre-commit hooks passing when an edit touches only
// non-testable code.
function runChanged(): number {
  return runVitest(['run', '--changed', '--passWithNoTests'], 'changed')
}

function runRelated(files: string[]): number {
  // `vitest related <files…>` defaults to watch mode; `--run` forces a
  // single non-watch execution. Pass the staged file list as positionals;
  // vitest walks the module graph from each.
  return runVitest(
    ['related', ...files, '--run', '--passWithNoTests'],
    `staged (${files.length} file(s))`,
  )
}

function main(): void {
  if (mode === 'all') {
    process.exitCode = runAll()
    return
  }

  const files = mode === 'staged' ? getStagedFiles() : getModifiedFiles()

  if (files.length === 0) {
    log(`No ${mode} files; skipping tests.`)
    return
  }

  if (shouldEscalate(files)) {
    log('Config files changed; escalating to full test suite.')
    process.exitCode = runAll()
    return
  }

  if (mode === 'staged') {
    process.exitCode = runRelated(files)
    return
  }

  // Working-tree changed → vitest's native --changed (it re-detects the
  // file list via git itself, including uncommitted edits).
  process.exitCode = runChanged()
}

main()
