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
 *   - `--staged` — pre-commit hook scope. NARROW by design: runs (a) staged test
 *     files directly, plus (b) for each staged SOURCE file, the test files that
 *     mirror it via the MIRROR resolver — never `vitest related` (that broad
 *     walk blew the pre-commit budget on a widely-imported util). The mirror
 *     resolver finds: bare basename tests, shard tests (basename-hyphen
 *     prefix), check-by-name tests for check scripts, and any test file whose
 *     first-party imports include the staged source (direct importers, the
 *     accurate catch for not-yet-renamed tests). Untracked paths are dropped so
 *     a foreign, mid-write test another live actor hasn't committed can't gate
 *     a commit. The staged lane stays tight to what is being committed; the
 *     full suite at pre-push + CI covers cross-cutting impact. A staged source
 *     file with no committed mirror test simply runs nothing at commit time
 *     (its impact is caught at the gate).
 *   - `--all` — run the full suite (`vitest run`). Used in CI and on explicit
 *     opt-in. Flags: `--quiet` / `--silent` suppress progress output. Config /
 *     infrastructure changes (`vitest.config*`, `tsconfig*`, `.oxlintrc.json`,
 *     `.oxfmtrc.json`, `pnpm-lock.yaml`, `package.json`, the vitest setup
 *     files, and the test runner itself) still escalate to `all` — module-graph
 *     traversal doesn't capture config-derived discovery + alias changes. An
 *     ordinary source file under `scripts/` or `.config/` does NOT escalate;
 *     its tests are reachable via `vitest related`. See
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

import { resolveScopeMode } from './_shared/scope-flags.mts'
import {
  firstPartyImports,
  isCheckByName,
} from './check/tests-are-mirror-named.mts'
import {
  GENERATED_GLOBS,
  isGeneratedPath,
} from './constants/generated-globs.mts'

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
const mode = resolveScopeMode(args)
const quiet = args.includes('--quiet') || args.includes('--silent')
const stdio: SpawnSyncOptions['stdio'] = quiet ? 'pipe' : 'inherit'
// On Windows, `pnpm` is a .cmd shim that Node refuses to exec directly via
// spawnSync (CVE-2024-27980 hardening). Wrap through the shell on Windows
// only; POSIX keeps direct invocation.
const useShell = process.platform === 'win32'

// Paths that, when changed, force the full suite to run.
const ESCALATION_PATTERNS = [
  // Discovery / resolution config only — a change here is invisible to the
  // module-graph walk (no source file imports it) yet changes which tests run
  // or how specifiers resolve, so the scoped run can't be trusted. An ordinary
  // source file under scripts/ or .config/ is NOT here: its tests are reachable
  // via `vitest related`, so escalating on it just runs the whole suite for
  // nothing.
  /(?:^|\/)vitest\.config\.(?:js|mjs|mts|ts)$/,
  /(?:^|\/)vitest\.json$/,
  /(?:^|\/)tsconfig.*\.json$/,
  /(?:^|\/)package\.json$/,
  /^pnpm-lock\.yaml$/,
  /(?:^|\/)\.oxlintrc\.json$/,
  /(?:^|\/)\.oxfmtrc\.json$/,
  /^scripts\/fleet\/test\.mts$/,
  /(?:^|\/)test\/scripts\/(?:fleet|repo)\/setup\.mts$/,
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

// Untracked, non-ignored paths (git's "others"). Excluded from the staged run
// so a foreign, mid-write test another live actor hasn't committed yet can't
// gate a staged commit on a file outside its own scope.
function getUntrackedFiles(): string[] {
  return gitFiles(['ls-files', '--others', '--exclude-standard'])
}

// A path that IS a test file (vitest's default test-file shape).
function isTestFile(filePath: string): boolean {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath)
}

// The mirror test(s) of a SOURCE file, found by the MIRROR resolver (not by
// vitest related). The finder receives the repo-relative source path and returns
// the repo-relative test paths that mirror it. `finder` is injected so the
// resolver is unit-tested without a filesystem.
export function mirrorTestsFor(
  sourcePath: string,
  finder: (sourcePath: string) => readonly string[],
): string[] {
  if (!sourcePath) {
    return []
  }
  return [...finder(sourcePath)]
}

// Build the NARROWED staged test set: staged test files run directly, plus each
// staged source file's mirror test(s) from the MIRROR resolver. Untracked paths
// are dropped so a foreign, mid-write test another live actor hasn't committed
// can't gate this commit. Pure (inputs + finder injected) so the scope rule is
// unit-tested without spawning vitest or touching the filesystem.
export function buildStagedTestFiles(
  stagedFiles: readonly string[],
  untrackedFiles: readonly string[],
  finder: (sourcePath: string) => readonly string[],
): string[] {
  const untracked = new Set(untrackedFiles)
  const out = new Set<string>()
  for (const f of stagedFiles) {
    if (isTestFile(f)) {
      out.add(f)
      continue
    }
    for (const t of mirrorTestsFor(f, finder)) {
      out.add(t)
    }
  }
  for (const u of untracked) {
    out.delete(u)
  }
  return [...out]
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

function runVitest(
  vitestArgs: string[],
  label: string,
  options?: { env?: Record<string, string> | undefined },
): number {
  const opts = { __proto__: null, ...options } as {
    env?: Record<string, string> | undefined
  }
  log(`Test scope: ${label}`)
  const configArgs = existsSync(ROOT_VITEST_CONFIG)
    ? ['--config', ROOT_VITEST_CONFIG]
    : []
  const r = spawnSync(
    VITEST_BIN,
    [...vitestArgs, ...configArgs],
    // Windows shell-shim rationale: see useShell at file top.
    {
      shell: useShell,
      stdio,
      ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
    },
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

// The test-file glob patterns, one pattern each for .mts/.ts/.mjs/.cjs/.js/.tsx/.jsx.
const TEST_EXTENSIONS = '{mts,ts,mjs,cjs,js,tsx,jsx}'

// Filesystem-only test-file count (no vitest subprocess), matching the SAME
// `**/`-anchored shape as the root vitest config's `include`. Lets `runAll()`
// fail loud BEFORE spawning vitest, rather than trusting vitest's own
// `passWithNoTests: true` to silently report "0 tests, all passed" — the
// zero-package delegation failure mode `runWorkspaceTests()` already guards
// for the no-root-config layout, extended to the root-config-present one.
// Counts co-located `src/**` specs too (socket-webext's layout) so a repo
// whose config includes them isn't misread as test-less.
function totalTestFileCount(): number {
  return globSync(
    [
      `**/src/**/*.test.${TEST_EXTENSIONS}`,
      `**/test/**/*.test.${TEST_EXTENSIONS}`,
    ],
    {
      cwd: repoRoot,
      absolute: false,
      ignore: [
        '**/node_modules/**',
        ...GENERATED_GLOBS,
        '.git-hooks/**',
        '.config/fleet/oxlint-plugin/**',
        'scripts/**/test/**',
        '.claude/hooks/**/test/**',
        'template/**',
      ],
    },
  ).length
}

function runAll(): number {
  if (isDelegatedWorkspace()) {
    return runWorkspaceTests()
  }
  // A root-config-present monorepo (`packages:` in pnpm-workspace.yaml) that
  // discovers zero test files anywhere is always a misconfiguration — never a
  // legitimate "no tests yet" state, since establishing a `packages:` split
  // implies the repo is past scaffolding. A single-package repo keeps the
  // documented scaffolding-only allowance (vitest's own `passWithNoTests`).
  if (existsSync(ROOT_WORKSPACE_MANIFEST) && totalTestFileCount() === 0) {
    log(
      [
        'Tests failed: this is a monorepo workspace (pnpm-workspace.yaml declares `packages:`), but zero test files resolve under any `test/` or `src/` tree.',
        `Where: ${ROOT_VITEST_CONFIG} \`include\` (\`**/{test,src}/**/*.test.{...}\`) against ${repoRoot}.`,
        'Saw: 0 matching test files; wanted: at least 1 — a full-suite run over a monorepo that discovers nothing proves nothing and would silently mask every package losing its tests.',
        'Fix: confirm each package under packages/*/test/ still ships its test files, and that no exclude glob (GENERATED_GLOBS, template/**, …) newly swallows them.',
      ].join('\n'),
    )
    return 1
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

// Find a source file's mirror test files by the MIRROR resolver:
//   (1) `**/test/**/<base>.test.*` — bare basename match
//   (2) `**/test/**/<base>-*.test.*` — shard tests (e.g. cover-thresholds for cover.mts)
//   (3) `**/test/**/check-<base>.test.*` — check-by-name tests, only when
//       a `scripts/.../check/<base>.mts` enforcer exists (isCheckByName)
//   (4) any test file under a `test/` tree whose first-party imports include this
//       source (direct importers — the accurate catch for not-yet-renamed tests)
//
// Never uses `vitest related`; stays bounded to test/ trees only. `**/`-anchored
// (not root-anchored `test/**`) so a monorepo's nested `packages/<name>/test/`
// mirrors resolve the same as a single-package repo's root `test/` — the same
// fix as the vitest config's `include` (see .config/repo/vitest.config.mts).
export function findMirrorTests(sourcePath: string, root: string): string[] {
  const base = path.basename(sourcePath).replace(/\.[cm]?[jt]sx?$/, '')
  if (!base) {
    return []
  }
  const out = new Set<string>()

  // (1) Bare basename: **/test/**/<base>.test.*
  const bare = globSync([`**/test/**/${base}.test.${TEST_EXTENSIONS}`], {
    cwd: root,
    absolute: false,
    ignore: ['**/node_modules/**'],
  })
  for (const f of bare) {
    out.add(f)
  }

  // (2) Shards: **/test/**/<base>-*.test.*
  const shards = globSync([`**/test/**/${base}-*.test.${TEST_EXTENSIONS}`], {
    cwd: root,
    absolute: false,
    ignore: ['**/node_modules/**'],
  })
  for (const f of shards) {
    out.add(f)
  }

  // (3) Check-by-name: **/test/**/check-<base>.test.* only when the check exists.
  if (isCheckByName(`check-${base}`, root)) {
    const checkTests = globSync(
      [`**/test/**/check-${base}.test.${TEST_EXTENSIONS}`],
      {
        cwd: root,
        absolute: false,
        ignore: ['**/node_modules/**'],
      },
    )
    for (const f of checkTests) {
      out.add(f)
    }
  }

  // (4) Direct importers: scan all test files for those whose first-party
  // imports include this source. This is the accurate catch for test files that
  // haven't been renamed yet, or that test a source under a different basename.
  const allTests = globSync(
    [
      `**/test/**/*.test.${TEST_EXTENSIONS}`,
      `**/test/**/*.spec.${TEST_EXTENSIONS}`,
    ],
    {
      cwd: root,
      absolute: false,
      ignore: ['**/node_modules/**'],
    },
  )
  for (const rel of allTests) {
    if (out.has(rel)) {
      continue
    }
    const abs = path.join(root, rel)
    let content = ''
    try {
      content = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const imports = firstPartyImports(content, path.dirname(abs), root)
    if (imports.includes(sourcePath)) {
      out.add(rel)
    }
  }

  return [...out]
}

function runStaged(files: string[]): number {
  // NARROW staged lane: run the staged test files + each staged source file's
  // mirror tests via the MIRROR resolver (never vitest related). `vitest run
  // <files>` runs exactly the resolved test files (no watch).
  //
  // `--no-file-parallelism` forces a single worker for the staged run only —
  // the root config's local default is a 16-thread pool, which is both the
  // worker-pool-deadlock surface (a hung worker the parent waits on forever,
  // seen as workers frozen at 0% CPU holding .git/index.lock) and a CPU bomb
  // when several Claude sessions share one checkout. CI and `--all` keep full
  // parallelism; the staged set is small, so one worker is fine.
  const testFiles = buildStagedTestFiles(
    files,
    getUntrackedFiles(),
    sourcePath => findMirrorTests(sourcePath, repoRoot),
  )
  if (testFiles.length === 0) {
    log('No staged test files or mirror tests; skipping the staged test run.')
    return 0
  }
  return runVitest(
    ['run', ...testFiles, '--passWithNoTests', '--no-file-parallelism'],
    `staged (${testFiles.length} test file(s))`,
  )
}

// Explicit positional file paths → the fast, file-scoped run. This is the
// fleet-canonical replacement for a raw `node_modules/.bin/vitest run <file>`:
// `pnpm test <file…>` runs exactly those files (vitest `run <files>`), so no
// one ever needs to reach past the script to the bare binary. Flags (scope +
// --quiet/--silent) are filtered out; what remains is treated as file paths.
function fileArgs(): string[] {
  return args.filter(a => !a.startsWith('-'))
}

function runFiles(files: string[]): number {
  // `vitest run <files…>` executes exactly the named test files (no watch),
  // the fast path for "test this one file". --passWithNoTests keeps a path
  // that resolves to no test file from erroring.
  //
  // A template/ path is the CANONICAL copy, which the config excludes by
  // default (the cascaded live copy is what the suite runs). Setting
  // FLEET_TEST_TEMPLATE=1 lifts that one exclude so `pnpm test
  // template/base/.../x.test.mts` verifies a canonical test IN PLACE — before
  // the cascade — instead of forcing a commit + cascade just to run it.
  const includeTemplate = files.some(f => f.startsWith('template/'))
  return runVitest(
    ['run', ...files, '--passWithNoTests'],
    `files (${files.length})`,
    includeTemplate ? { env: { FLEET_TEST_TEMPLATE: '1' } } : undefined,
  )
}

function main(): void {
  const explicitFiles = fileArgs()
  if (explicitFiles.length > 0) {
    process.exitCode = runFiles(explicitFiles)
    return
  }

  if (mode === 'all') {
    process.exitCode = runAll()
    return
  }

  // Drop generated/vendored paths (build output, vendored trees) before they
  // reach the staged resolver: transforming a tracked multi-MB generated blob
  // (e.g. a base64-embedded wasm) to build the module graph can hang the
  // pre-commit run. They're excluded from discovery anyway (vitest config
  // `exclude`, same source), so a change to one has no owned test to re-run.
  // See constants/generated-globs.mts.
  const files = (
    mode === 'staged' ? getStagedFiles() : getModifiedFiles()
  ).filter(f => !isGeneratedPath(f))

  if (files.length === 0) {
    log(
      `No ${mode} source files (generated/vendored excluded); skipping tests.`,
    )
    return
  }

  // No-root-config workspace: root-level scoped vitest bypasses per-package
  // env wrappers, so delegate every scope to per-package test:unit.
  if (isDelegatedWorkspace()) {
    process.exitCode = runWorkspaceTests()
    return
  }

  // `--staged` (pre-commit) NEVER escalates to the full suite: it is a fast,
  // bounded, non-blocking reminder, and escalating just burns the 60s budget
  // running a truncated full suite that proves nothing. Config-derived
  // discovery changes are validated by the full suite at pre-push + CI (the
  // real gates), not in the commit hook. Only the local-dev `changed` scope
  // escalates, where a thorough local run is worth the wait.
  if (mode !== 'staged' && shouldEscalate(files)) {
    log('Config files changed; escalating to full test suite.')
    process.exitCode = runAll()
    return
  }

  if (mode === 'staged') {
    process.exitCode = runStaged(files)
    return
  }

  // Working-tree changed → vitest's native --changed (it re-detects the
  // file list via git itself, including uncommitted edits).
  process.exitCode = runChanged()
}

// Entrypoint-guarded so importing this module (e.g. a unit test of
// buildRelatedArgs) doesn't kick off a vitest run.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
