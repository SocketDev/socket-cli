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
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import type { SpawnSyncOptions } from '@socketsecurity/lib-stable/process/spawn/types'

const logger = getDefaultLogger()

// Anchor on the script's own location, not process.cwd() (unstable in scripts/
// per `no-process-cwd-in-scripts-hooks`): the canonical runner lives at
// <repo>/scripts/fleet/test.mts, so the repo root is two directories up.
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

// Resolve the vitest binary from the repo-root node_modules/.bin instead of
// `pnpm exec vitest` (fleet `no-pm-exec-guard`: `pnpm exec` is banned for its
// wrapper overhead — call the bin directly).
const VITEST_BIN = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  WIN32 ? 'vitest.cmd' : 'vitest',
)

// Root package.json marks a monorepo workspace. When the full suite runs in a
// workspace that has no root vitest config, a bare root `vitest run` discovers
// every package's config — including build artifacts + templates — and runs
// them without the per-package env wrappers (e.g. INLINED_* injection), which
// fails or hangs. Delegate to the per-package `test:unit` scripts instead.
const ROOT_WORKSPACE_MANIFEST = 'pnpm-workspace.yaml'

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
    VITEST_BIN,
    [...vitestArgs, ...configArgs],
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

function runWorkspaceTests(): number {
  // `pnpm -r run` (recursive run, not the banned `pnpm exec`) invokes each
  // package's own test script, so every package runs under its configured env
  // wrapper / vitest config. `--if-present` skips packages lacking the script
  // (without it, ZERO matches is a hard `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`, not
  // the intended skip). Repos split unit from integration under `test:unit`;
  // most define only `test`. Try `test:unit`, then `test`, and FAIL LOUD if
  // neither script exists in any package — a delegated workspace that runs zero
  // tests is a silent green that proves nothing, worse than an error.
  for (const script of ['test:unit', 'test']) {
    const probe = spawnSync(
      'pnpm',
      ['-r', '--workspace-concurrency=1', 'run', '--if-present', script],
      { shell: useShell, stdio },
    )
    if (probe.status !== 0) {
      log('Tests failed')
      return 1
    }
    if (workspaceHasScript(script)) {
      log(`All tests passed (workspace per-package \`${script}\`)`)
      return 0
    }
  }
  log(
    'Tests failed: no workspace package defines a `test:unit` or `test` script — the delegated test path would run nothing. Add a `test` script to the package(s) under test.',
  )
  return 1
}

// True when at least one workspace package declares the given npm script.
// `pnpm -r run --if-present <s>` exits 0 even when zero packages match, so a
// green exit alone can't tell "all passed" from "nothing ran"; this scans the
// package manifests to disambiguate. Globs the manifests directly rather than
// parsing `pnpm -r list --json` (whose stdout the Socket Firewall wrapper
// prefixes with a banner, breaking JSON.parse and silently defeating the scan).
function workspaceHasScript(script: string): boolean {
  const manifests = globSync(['**/package.json'], {
    cwd: repoRoot,
    absolute: true,
    ignore: ['**/node_modules/**'],
  })
  for (let i = 0, { length } = manifests; i < length; i += 1) {
    try {
      const manifest = JSON.parse(readFileSync(manifests[i]!, 'utf8')) as {
        scripts?: Record<string, unknown> | undefined
      }
      if (manifest.scripts && script in manifest.scripts) {
        return true
      }
    } catch {
      // Unreadable / non-JSON manifest — skip it.
    }
  }
  return false
}

// A workspace with no root vitest config keeps its config + env wrappers (e.g.
// INLINED_* injection) per package. Root-level `vitest run` / `vitest related`
// / `vitest --changed` all bypass those wrappers, so any scoped run there fails
// or hangs. In that layout every scope delegates to per-package `test:unit`;
// the per-file related/changed filtering vitest would do at the root is the
// optimization that breaks, and a per-package full run is the safe trade.
function isDelegatedWorkspace(): boolean {
  return !existsSync(ROOT_VITEST_CONFIG) && existsSync(ROOT_WORKSPACE_MANIFEST)
}

function runAll(): number {
  if (isDelegatedWorkspace()) {
    return runWorkspaceTests()
  }
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
  //
  // `--no-file-parallelism` forces a single worker for the pre-commit (staged)
  // run only — the root config's local default is a 16-thread pool, which is
  // both the worker-pool-deadlock surface (a hung worker the parent waits on
  // forever, seen as workers frozen at 0% CPU holding .git/index.lock) and a
  // CPU bomb when several Claude sessions share one checkout and each spawns 16
  // threads. A single worker can't inter-worker-starve, and N sessions × 1
  // thread is survivable. CI and `--all` keep full parallelism (this flag is
  // scoped to the staged path); the staged set is small, so one worker is fine.
  return runVitest(
    [
      'related',
      ...files,
      '--run',
      '--passWithNoTests',
      '--no-file-parallelism',
    ],
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

  // No-root-config workspace: root-level scoped vitest bypasses per-package
  // env wrappers, so delegate every scope to per-package test:unit.
  if (isDelegatedWorkspace()) {
    process.exitCode = runWorkspaceTests()
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
