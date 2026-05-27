/* eslint-disable no-shadow -- nested cached-length for-loops intentionally reuse `i`/`length` names for the fleet-wide cached-loop idiom; renaming would diverge from the codebase pattern. */
/**
 * @file Canonical minimal test runner for socket-* repos. Scope modes:
 *   (default) Run tests covering files modified in the working tree vs HEAD.
 *   --staged Run tests covering files in the git index (pre-commit hook). --all
 *   Run the full test suite. Flags: --quiet Suppress progress output.
 *   Scope-to-tests mapping (adapt per repo layout):
 *
 *   - Changed test files run themselves.
 *   - Changed source files under `packages/<pkg>/src/` run the sibling
 *     `packages/<pkg>/test/` folder. Non-workspace repos can adapt the
 *     resolveTestPatterns() function to their layout (e.g. single src/ + test/
 *     at root, or tests colocated with source).
 *   - Config / infrastructure changes escalate to the full suite. This is the
 *     minimal zero-dependency reference implementation. Larger repos
 *     (socket-registry, socket-sdk-js, socket-packageurl-js, etc.) use a richer
 *     version; this one keeps the same CLI contract so pre-commit hooks and CI
 *     work identically across repos.
 */

// prefer-async-spawn: sync-required — top-level CLI runner; entire
// flow is sync (test runner invocation + exit-code aggregation).
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import type { SpawnSyncOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import process from 'node:process'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

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
  /^vitest\.config\.(js|mjs|mts|ts)$/,
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

/**
 * Map changed files to vitest test patterns.
 *
 * Default implementation handles two common layouts:
 *
 * - Pnpm workspace: packages/<pkg>/src/... → packages/<pkg>/test
 * - Single repo: src/... → test Adapt to your repo's layout if different.
 */
function resolveTestPatterns(files: string[]): string[] {
  const patterns = new Set<string>()
  for (let i = 0, { length } = files; i < length; i += 1) {
    const f = files[i]!
    // Test file itself.
    if (/\.test\.(m?[jt]s)$/.test(f)) {
      patterns.add(f)
      continue
    }
    // Workspace source file. Only emit the pattern if the test dir exists;
    // packages without a test/ directory are skipped rather than making
    // vitest error on an unknown pattern.
    const wsMatch = f.match(/^(packages\/[^/]+)\/src\//)
    if (wsMatch && existsSync(`${wsMatch[1]}/test`)) {
      patterns.add(`${wsMatch[1]}/test`)
      continue
    }
    // Single-repo source file.
    if (f.startsWith('src/') && existsSync('test')) {
      patterns.add('test')
    }
  }
  return [...patterns]
}

function runAll(): number {
  log('Test scope: all')
  const r = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', '.config/vitest.config.mts'],
    { shell: useShell, stdio },
  )
  if (r.status !== 0) {
    log('Tests failed')
    return 1
  }
  log('All tests passed')
  return 0
}

function runPatterns(patterns: string[]): number {
  if (patterns.length === 0) {
    log('No tests to run; skipping.')
    return 0
  }
  log(`Test scope: ${mode} (${patterns.length} pattern(s))`)
  // --passWithNoTests: if a pattern produces zero matches (e.g. a freshly
  // added package with an empty test dir, or a source change that doesn't
  // touch any testable code), vitest treats it as success rather than a
  // "no test files found" error. Scoped-by-default runs shouldn't fail
  // just because the change didn't happen to touch a testable file.
  const r = spawnSync(
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      '--config',
      '.config/vitest.config.mts',
      '--passWithNoTests',
      ...patterns,
    ],
    // Continuing the same Windows shell-shim rationale (see useShell at file top).
    { shell: useShell, stdio },
  )
  if (r.status !== 0) {
    log('Tests failed')
    return 1
  }
  log('All tests passed')
  return 0
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

  const patterns = resolveTestPatterns(files)
  process.exitCode = runPatterns(patterns)
}

main()
