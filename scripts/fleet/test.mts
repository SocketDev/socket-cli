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
 *     resolver finds: bare basename tests, shard tests that import the source
 *     (basename-hyphen prefix), check-by-name tests for check scripts, and any
 *     test file whose first-party imports include the staged source (direct
 *     importers, the accurate catch for not-yet-renamed tests). Untracked paths
 *     are dropped so a foreign, mid-write test another live actor hasn't
 *     committed can't gate a commit. The staged lane stays tight to what is
 *     being committed; the full suite at pre-push + CI covers cross-cutting
 *     impact. A staged source file with no committed mirror test simply runs
 *     nothing at commit time (its impact is caught at the gate).
 *   - `--all` — run the full suite (`vitest run`). Used in CI and on explicit
 *     opt-in. `--shard=<index>/<count>` partitions that full suite across CI
 *     jobs. Flags: `--quiet` / `--silent` suppress progress output. Config /
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
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import type { SpawnSyncOptions } from '@socketsecurity/lib-stable/process/spawn/types'

import { hasLiveForeignActiveRun } from './_shared/active-run-marker.mts'
import { isScopeFlag, resolveScopeMode } from './_shared/scope-flags.mts'
import {
  firstPartyImports,
  isCheckByName,
} from './check/tests-are-mirror-named.mts'
import {
  GENERATED_GLOBS,
  isGeneratedPath,
} from './constants/generated-globs.mts'
import { ensurePinnedNode } from './lib/ensure-node.mts'
import { isMainModule } from './_shared/is-main-module.mts'

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

// Test LANES — a SPEED category orthogonal to scope. `--lane fast|mid|slow`
// runs that lane (membership from `vitest.lanes` in the settings file); bare
// `pnpm test` defaults to the fast lane. See .config/repo/vitest.config.mts.
const VALID_LANES: ReadonlySet<string> = new Set(['fast', 'mid', 'slow'])
// Pull the `--lane <value>` / `--lane=<value>` flag out of argv and return the
// rest, so the scope/shard parsers never mistake the lane value for a file.
function extractLane(argv: readonly string[]): {
  lane: string | undefined
  rest: string[]
} {
  const rest: string[] = []
  let lane: string | undefined
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    let value: string | undefined
    if (arg === '--lane') {
      i += 1
      value = argv[i]
    } else if (arg.startsWith('--lane=')) {
      value = arg.slice('--lane='.length)
    } else {
      rest.push(arg)
      continue
    }
    if (!value || !VALID_LANES.has(value)) {
      throw new Error(
        'Invalid --lane value.\n' +
          '  Where: scripts/fleet/test.mts CLI argument parsing.\n' +
          `  Saw: ${value ?? '(missing value)'}; wanted one of fast | mid | slow.\n` +
          '  Fix: pass --lane fast (the bare `pnpm test` default), --lane mid, or --lane slow.',
      )
    }
    lane = value
  }
  return { lane, rest }
}

const { lane: laneFlag, rest: args } = extractLane(process.argv.slice(2))
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

function gitFiles(args: string[], cwd?: string | undefined): string[] {
  // spawnSync with array args — no shell interpolation. Matches the
  // socket/prefer-spawn-over-execsync rule contract.
  const r = spawnSync('git', args, {
    ...(cwd ? { cwd } : {}),
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
  return /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(filePath)
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

// Resolve the child env for a vitest spawn, always dropping COVERAGE. Coverage
// is owned by cover.mts, which spawns the outer vitest DIRECTLY (never via
// test.mts), so any COVERAGE reaching test.mts belongs to a NESTED run — a
// subprocess-spawning test re-entered test.mts (via `pnpm test` / a git hook)
// while the outer coverage run is live. A nested vitest with coverage on would
// clean the shared coverage/.tmp and ENOENT the outer forks' reports (the reason
// coverage used to force `maxWorkers: 1`). test.mts never collects coverage
// itself, so strip it and let the suite run parallel without the clobber.
function resolveVitestEnv(
  optsEnv: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...optsEnv }
  delete env['COVERAGE']
  return env
}

function runVitest(
  vitestArgs: string[],
  label: string,
  options?: { env?: Record<string, string> | undefined } | undefined,
): number {
  const opts = { __proto__: null, ...options } as {
    env?: Record<string, string> | undefined
  }
  // Announce the effective budget tier so a CI log answers "which timeout did
  // the config compute?" without a probe commit — a 30s timeout under a
  // config that should compute 60s on CI is diagnosable from the run log.
  log(
    `Test scope: ${label} (CI=${process.env['CI'] ? 'yes' : 'no'}, budget tier: ${process.env['CI'] ? '60s' : '10s local'})`,
  )
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
      env: resolveVitestEnv(opts.env),
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
  return shouldDelegateWorkspace(mode, {
    rootVitestConfigExists: existsSync(ROOT_VITEST_CONFIG),
    workspaceManifestExists: existsSync(ROOT_WORKSPACE_MANIFEST),
  })
}

// Pre-commit is deliberately file-scoped even in a delegated workspace. Once
// hook packages are registered as workspace members, `pnpm -r run test` fans
// out across hundreds of hook manifests; a lockfile-only commit then spends
// its entire budget launching empty test processes. Full/changed runs retain
// per-package delegation and therefore keep package-specific env wrappers.
export function shouldDelegateWorkspace(
  scopeMode: string,
  config: { rootVitestConfigExists: boolean; workspaceManifestExists: boolean },
): boolean {
  const cfg = { __proto__: null, ...config } as typeof config
  return (
    scopeMode !== 'staged' &&
    !cfg.rootVitestConfigExists &&
    cfg.workspaceManifestExists
  )
}

export interface ParsedTestRunnerArgs {
  files: string[]
  shard: string | undefined
}

export function parseTestRunnerArgs(
  argv: readonly string[],
): ParsedTestRunnerArgs {
  const files: string[] = []
  let shard: string | undefined

  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    let candidate: string | undefined
    if (arg === '--shard') {
      i += 1
      candidate = argv[i]
    } else if (arg.startsWith('--shard=')) {
      candidate = arg.slice('--shard='.length)
    } else if (!arg.startsWith('-')) {
      files.push(arg)
      continue
    } else {
      continue
    }

    const match = /^(?<index>[1-9]\d*)\/(?<count>[1-9]\d*)$/.exec(
      candidate ?? '',
    )
    if (
      !match?.groups ||
      Number(match.groups['index']) > Number(match.groups['count']) ||
      shard !== undefined
    ) {
      throw new Error(
        'Invalid test shard argument.\n' +
          'Where: scripts/fleet/test.mts CLI argument parsing.\n' +
          `Saw: ${candidate ?? '(missing value)'}; wanted one --shard=<index>/<count> with 1 <= index <= count.\n` +
          'Fix: pass a single shard such as --shard=1/4 alongside --all.',
      )
    }
    shard = candidate
  }

  return { files, shard }
}

// The test-file glob patterns, one pattern each for .mts/.ts/.mjs/.cjs/.js/.tsx/.jsx.
const TEST_EXTENSIONS = '{mts,ts,mjs,cjs,js,tsx,jsx}'

interface MirrorTestIndex {
  readonly importersBySource: ReadonlyMap<string, readonly string[]>
  readonly testFiles: readonly string[]
}

// A staged run may resolve mirrors for many source files. Index each repo's
// test tree once so that cost is O(tests + sources), not O(tests × sources).
const mirrorTestIndexCache = new Map<string, MirrorTestIndex>()

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

function runAll(shard?: string | undefined): number {
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
  return runVitest(
    ['run', ...(shard ? ['--shard', shard] : [])],
    shard ? `all (shard ${shard})` : 'all',
  )
}

// --passWithNoTests: a scoped run where the changed files don't resolve
// to any test file should succeed rather than error with "No test files
// found". Keeps pre-commit hooks passing when an edit touches only
// non-testable code.
function runChanged(): number {
  return runVitest(['run', '--changed', '--passWithNoTests'], 'changed')
}

function mirrorTestIndex(root: string): MirrorTestIndex {
  const resolvedRoot = path.resolve(root)
  const cached = mirrorTestIndexCache.get(resolvedRoot)
  if (cached) {
    return cached
  }
  const tracked = gitFiles(['ls-files'], resolvedRoot)
  // Git is the fast and exact index for a real checkout: it omits ignored
  // output and submodule contents. A non-git fixture falls back to the glob.
  const testFiles = tracked.length
    ? tracked.filter(
        file => /(?:^|\/)test\//.test(normalizePath(file)) && isTestFile(file),
      )
    : globSync(
        [
          `**/test/**/*.test.${TEST_EXTENSIONS}`,
          `**/test/**/*.spec.${TEST_EXTENSIONS}`,
        ],
        {
          cwd: resolvedRoot,
          absolute: false,
          ignore: ['**/node_modules/**'],
        },
      )
  const importersBySource = new Map<string, string[]>()
  for (let i = 0, { length } = testFiles; i < length; i += 1) {
    const rel = testFiles[i]!
    const abs = path.join(resolvedRoot, rel)
    let content = ''
    try {
      content = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const imports = firstPartyImports(content, path.dirname(abs), resolvedRoot)
    for (let j = 0, { length } = imports; j < length; j += 1) {
      const source = imports[j]!
      const importers = importersBySource.get(source)
      if (importers) {
        importers.push(rel)
      } else {
        importersBySource.set(source, [rel])
      }
    }
  }
  const index = { importersBySource, testFiles }
  mirrorTestIndexCache.set(resolvedRoot, index)
  return index
}

// Find a source file's mirror test files by the MIRROR resolver:
//   (1) `**/test/**/<base>.test.*` — bare basename match
//   (2) direct importers named `**/test/**/<base>-*.test.*` — shard tests
//       (e.g. cover-thresholds for cover.mts); requiring the import prevents a
//       generic source such as test.mts from claiming unrelated test-* specs
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
  const index = mirrorTestIndex(root)
  const checkBase = `check-${base}`
  const acceptsCheckName = isCheckByName(checkBase, root)
  const importers = index.importersBySource.get(sourcePath) ?? []
  const importerSet = new Set(importers)
  for (let i = 0, { length } = index.testFiles; i < length; i += 1) {
    const rel = index.testFiles[i]!
    if (!/\.test\.[cm]?[jt]sx?$/.test(rel)) {
      continue
    }
    const testBase = path.basename(rel).replace(/\.test\.[cm]?[jt]sx?$/, '')
    if (
      testBase === base ||
      (testBase.startsWith(`${base}-`) && importerSet.has(rel)) ||
      (acceptsCheckName && testBase === checkBase)
    ) {
      out.add(rel)
    }
  }
  for (let i = 0, { length } = importers; i < length; i += 1) {
    out.add(importers[i]!)
  }
  return [...out].toSorted()
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

function runFiles(files: string[]): number {
  // `vitest run <files…>` executes exactly the named test files (no watch),
  // the fast path for "test this one file". --passWithNoTests keeps a path
  // that resolves to no test file from erroring.
  //
  return runVitest(
    ['run', ...files, '--passWithNoTests'],
    `files (${files.length})`,
    undefined,
  )
}

function main(): void {
  // Re-exec under the pinned node when a stale PATH node (e.g. a Homebrew node
  // in a non-interactive shell that never sourced fnm) is below the hook floor,
  // so the vitest + hooks this spawns run on the fleet runtime.
  ensurePinnedNode()

  let parsedArgs: ParsedTestRunnerArgs
  try {
    parsedArgs = parseTestRunnerArgs(args)
  } catch (e) {
    logger.error(errorMessage(e))
    process.exitCode = 1
    return
  }
  if (parsedArgs.shard && mode !== 'all') {
    logger.error(
      'Test sharding requires full-suite scope.\n' +
        'Where: scripts/fleet/test.mts CLI scope resolution.\n' +
        `Saw: --shard=${parsedArgs.shard} with ${mode} scope; wanted --all.\n` +
        `Fix: run pnpm test --all --shard=${parsedArgs.shard}.`,
    )
    process.exitCode = 1
    return
  }

  // A concurrent vitest run during a live coverage run cleans the shared
  // coverage/.tmp and ENOENTs the outer run's v8 reports (two live
  // incidents on 2026-07-11 killed 15-minute cover runs at the merge
  // step). cover.mts registers an active-run marker; refuse to start
  // while one is live instead of corrupting it.
  if (
    !args.includes('--force-during-active-run') &&
    hasLiveForeignActiveRun()
  ) {
    // The staged pre-commit lane is non-blocking by design (its timeout
    // path already skips) — a hard refusal here would freeze ALL commits
    // for the length of any cover run. Skip like the timeout path; the
    // merge gate runs the full suite.
    if (mode === 'staged') {
      logger.log(
        'A long fleet run (coverage/build) is live — skipping the staged test lane (non-blocking; the merge gate runs the full suite).',
      )
      return
    }
    logger.error(
      'A long fleet run (coverage/build) is live — refusing to start vitest.\n' +
        '  Where: scripts/fleet/test.mts startup gate\n' +
        '  Saw vs wanted: a live active-run marker in ~/.claude/hooks/stale-process-sweeper/active-runs/; wanted none\n' +
        '  Fix: wait for the run to finish (or stop it), then re-run. Deliberate override: --force-during-active-run.',
    )
    process.exitCode = 1
    return
  }
  // Lane routing (a SPEED category, orthogonal to scope). `--lane fast|mid|slow`
  // runs that lane; bare `pnpm test` (no scope flag, no explicit files) defaults
  // to the fast lane for a quick local loop. --all / --staged / --changed and
  // explicit files intentionally run EVERY lane (so editing a slow-lane test
  // still runs it). The lane reaches the vitest config via FLEET_LANE, which
  // shapes the config's include/exclude.
  const hasScopeFlag = args.some(a => isScopeFlag(a))
  const effectiveLane =
    laneFlag ??
    (!hasScopeFlag && parsedArgs.files.length === 0 ? 'fast' : undefined)
  if (effectiveLane) {
    process.env['FLEET_LANE'] = effectiveLane
    process.exitCode = runVitest(['run'], `lane:${effectiveLane}`)
    return
  }

  // Explicit positional file paths take the fast file-scoped path. The parser
  // removes scope/runner flags and consumes the separate `--shard 1/4` value.
  const explicitFiles = parsedArgs.files
  if (explicitFiles.length > 0) {
    process.exitCode = runFiles(explicitFiles)
    return
  }

  if (mode === 'all') {
    process.exitCode = runAll(parsedArgs.shard)
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
if (isMainModule(import.meta.url)) {
  main()
}
