/* eslint-disable no-shadow -- nested cached-length for-loops intentionally reuse `i`/`length` names for the fleet-wide cached-loop idiom; renaming would diverge from the codebase pattern. */
/**
 * @file Canonical minimal lint runner for socket-* repos. Scope modes: Explicit
 *   positional file paths (e.g. `pnpm run lint <file…>`) lint exactly those
 *   files, tracked or brand-new — they win over every flag below, including
 *   --all. Otherwise: (default, or explicit --modified / its alias --changed)
 *   Lint files modified in the working tree vs HEAD. --staged Lint files in the
 *   git index (used by .git-hooks/pre-commit). --all Lint the entire workspace.
 *   Flags: --fix Auto-fix issues. --quiet Suppress progress output. If the
 *   chosen scope has no lintable files, the script is a no-op. Config or
 *   infrastructure changes (.config/fleet/oxlintrc.json,
 *   .config/fleet/oxfmtrc.json, tsconfig*.json, pnpm-lock.yaml, .config/**,
 *   scripts/**, package.json) escalate to `--all` automatically, since they can
 *   affect everything — EXCEPT under `--staged` (the pre-commit path), which
 *   always scopes strictly to the staged files so the commit hook stays fast (a
 *   config/scripts edit staged for commit would otherwise re-lint the whole
 *   tree, blowing the ≤10s pre-commit budget). The whole-tree correctness net
 *   for such changes is the pre-push `--all` gate + CI, not the commit hook.
 *   This is the minimal zero-dependency reference implementation; the oxlint /
 *   oxfmt / markdownlint / plugin-load runners live in
 *   `_shared/lint-runners.mts`. Larger repos (socket-lib, socket-registry,
 *   socket-sdk-js, etc.) use a richer version based on.
 *
 * @socketsecurity/lib-stable helpers; this one keeps the same CLI contract so
 *   pre-commit hooks and CI work identically across repos.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  acquireFixerLock,
  describeHolder,
  fixerLockPath,
} from './_shared/fixer-lock.mts'
import {
  filterFormatIgnored,
  getModifiedFiles,
  getStagedFiles,
} from './_shared/format-scope.mts'
import { createLintRunners } from './_shared/lint-runners.mts'
import { REPO_ROOT } from './paths.mts'
import { resolveScopeMode } from './_shared/scope-flags.mts'
import type { ScopeMode } from './_shared/scope-flags.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

const args = process.argv.slice(2)
const mode = resolveScopeMode(args)
const fix = args.includes('--fix')
const quiet = args.includes('--quiet') || args.includes('--silent')
// On Windows, `pnpm` is a .cmd shim that Node refuses to exec directly via
// spawnSync (CVE-2024-27980 hardening). The shell wrapper resolves the shim; on
// POSIX we keep direct invocation so no shell-quoting surface is introduced.
const useShell = process.platform === 'win32'

const LINTABLE_EXTS = new Set(['.cjs', '.cts', '.js', '.mjs', '.mts', '.ts'])

// Paths that, when touched, force a full-workspace lint.
const ESCALATION_PATTERNS = [
  /^\.config\//,
  /^scripts\//,
  /^pnpm-lock\.yaml$/,
  /^tsconfig.*\.json$/,
  /^package\.json$/,
  /^lockstep\.schema\.json$/,
]

function log(msg: string): void {
  if (!quiet) {
    logger.log(msg)
  }
}

const { runAll, runFiles } = createLintRunners({
  fix,
  log,
  quiet,
  stdio: quiet ? 'pipe' : 'inherit',
  useShell,
})

export function shouldEscalate(files: string[]): boolean {
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

// Whether a run in `mode` over `files` escalates to a full-workspace lint.
// `staged` NEVER escalates — the pre-commit hook must stay within its ≤10s
// budget, so it scopes strictly to the staged files regardless of which
// infrastructure paths they touch. `modified`/`all` keep the escalation net.
export function escalatesForScope(mode: ScopeMode, files: string[]): boolean {
  if (mode === 'staged') {
    return false
  }
  return shouldEscalate(files)
}

function filterLintable(files: string[]): string[] {
  return files.filter(f => LINTABLE_EXTS.has(path.extname(f)) && existsSync(f))
}

// Explicit positional file paths → linted unconditionally, tracked or not.
// `getModifiedFiles`/`getStagedFiles` resolve through `git diff`, which never
// surfaces an untracked (never-`git add`ed) file, so a brand-new file passed
// explicitly on the argv (`pnpm run fix <new-file>`) was silently dropped from
// the git-diff-derived scope while the scope-count log still reported success.
// Positional args (anything not starting with `-`) win over the git-diff scope
// entirely, matching `scripts/fleet/test.mts`'s `fileArgs()` convention: flags
// (scope flags, `--fix`, `--quiet`/`--silent`) are filtered out, and what
// remains is treated as file paths (existence + lintable-extension filtered
// downstream by `filterLintable`, same as the git-diff-derived scope).
export function resolveExplicitFiles(argv: readonly string[]): string[] {
  return argv.filter(a => !a.startsWith('-'))
}

/**
 * The loud-scope contract for fix runs: a `--fix` outside `--all` only touches
 * the files git already sees as changed, so a repo-wide autofix campaign run
 * that way is a SILENT no-op on the whole backlog (two delegated wave runs
 * reported success while fixing nothing, 2026-07-07). Every scoped fix run
 * ends with this reminder so the operator can tell "fixed my edits" apart
 * from "fixed the repo".
 */
export function fixScopeReminder(scopeMode: string): string {
  return (
    `fix applied to ${scopeMode.toUpperCase()} files only — the repo-wide backlog is untouched.\n` +
    'For a wave: pnpm run lint --fix --all  (add LINT_DOGFOOD=1 to reach template/).'
  )
}

// Lint `files` (already scoped) and report pass/fail + the fix-scope
// reminder. `scopeLabel` names the scope in the progress log — the git-diff
// mode ('modified'/'staged') or 'explicit' for argv-named files.
function lintFileSet(scopeLabel: string, files: string[]): void {
  // Pre-filter against the merged .prettierignore: oxfmt does not apply
  // --ignore-path to explicitly-passed argv files, so without this a staged
  // cascade-mirror path (.claude/**, scripts/fleet/**) red-lights the
  // pre-commit gate on bytes the format run never owns. template/** is exempt
  // inside filterFormatIgnored (the wheelhouse canon stays gated).
  const extLintable = filterLintable(files)
  const lintable = filterFormatIgnored(extLintable)
  const ignoredCount = extLintable.length - lintable.length
  if (ignoredCount > 0) {
    log(
      `${ignoredCount} format-ignored mirror file(s) skipped (cascade payload — gated at the template source).`,
    )
  }
  log(
    `Lint scope: ${scopeLabel} (${lintable.length} of ${files.length} files lintable)`,
  )
  process.exitCode = runFiles(lintable)
  if (process.exitCode === 0) {
    log('Lint passed')
  } else {
    log('Lint failed')
  }
  if (fix) {
    log(fixScopeReminder(scopeLabel))
  }
}

function main(): void {
  // Mutating (--fix) runs hold the repo-scoped fixer lock so concurrent or
  // zombie fixers never race the same tree; read-only lint runs stay
  // lock-free. fix.mts already holds the lock when it spawns this runner —
  // acquireFixerLock's env-var reentrancy makes the nested acquire a no-op.
  if (!fix) {
    runLint()
    return
  }
  const lock = acquireFixerLock(
    fixerLockPath(REPO_ROOT),
    'scripts/fleet/lint.mts --fix',
  )
  if (!lock.acquired) {
    logger.fail(`lint: ${describeHolder(lock.holder)}`)
    process.exitCode = 1
    return
  }
  try {
    runLint()
  } finally {
    lock.release()
  }
}

function runLint(): void {
  // Explicit positional file paths win over every scope mode (including
  // --all): they name exactly what to lint, tracked or brand-new, so the
  // git-diff/whole-tree scoping below never gets a say over them.
  const explicitFiles = resolveExplicitFiles(args)
  if (explicitFiles.length > 0) {
    lintFileSet('explicit', explicitFiles)
    return
  }

  if (mode === 'all') {
    log('Lint scope: all')
    process.exitCode = runAll()
    if (process.exitCode === 0) {
      log('Lint passed')
    } else {
      log('Lint failed')
    }
    return
  }

  const files = mode === 'staged' ? getStagedFiles() : getModifiedFiles()

  if (files.length === 0) {
    log(`No ${mode} files; skipping lint.`)
    if (fix) {
      log(fixScopeReminder(mode))
    }
    return
  }

  if (escalatesForScope(mode, files)) {
    log(`Config files changed; escalating to full lint.`)
    process.exitCode = runAll()
    if (process.exitCode === 0) {
      log('Lint passed')
    } else {
      log('Lint failed')
    }
    return
  }

  lintFileSet(mode, files)
}

const invokedDirectly = isMainModule(import.meta.url)
if (invokedDirectly) {
  main()
}
