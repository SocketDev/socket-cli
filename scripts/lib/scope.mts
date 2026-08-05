/**
 * @file Shared scope resolution for the socket-cli runners (`lint`, `fix`,
 *   `check`). One place decides how the scope flags map to a mode and how a
 *   mode maps to a file list, so every runner accepts the SAME flags
 *   identically instead of each re-deriving them and drifting. The modes:
 *
 *     --all       the whole workspace
 *     --staged    the git index (what the pre-commit hook uses)
 *     --modified  files modified in the working tree vs HEAD; also the
 *                 no-flag default
 *     --changed   alias of --modified
 *
 *   `--all` beats `--staged`, which beats the modified default. Explicit
 *   positional file paths beat all of them.
 *
 *   The other half of the contract is the ZERO-SCOPE verdict: a run whose scope
 *   resolves to no lintable files checked nothing, so it is not a pass. Saying
 *   "no modified files, skipping" reads exactly like a green gate, which is how
 *   a clean-tree run can hide a tree full of errors. Every zero-scope exit says
 *   "0 files checked — this is NOT a pass" instead.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

export type ScopeMode = 'all' | 'modified' | 'staged'

/**
 * Every scope flag the runners recognize. `--changed` is the alias of
 * `--modified`; both select the working-tree-vs-HEAD scope.
 */
export const SCOPE_FLAGS: readonly string[] = [
  '--all',
  '--changed',
  '--modified',
  '--staged',
]

/**
 * File extensions the JavaScript/TypeScript linters can read. A scope is
 * filtered to these before any linter is spawned, so a docs-only or
 * workflow-only change never hands a linter a file it would choke on.
 */
export const LINTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
])

/**
 * Extensions the formatter handles on top of {@link LINTABLE_EXTENSIONS}.
 * Biome formats JSON as well, so the formatter scope keeps those paths.
 */
export const FORMATTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ...LINTABLE_EXTENSIONS,
  '.json',
  '.jsonc',
])

/**
 * Paths that force a full-workspace run when touched. A lint config, a
 * tsconfig, the lockfile, or a script can change the verdict for files nobody
 * edited, so a scoped run over them would be misleading.
 */
const ESCALATION_PATTERNS: readonly RegExp[] = [
  /^\.config\//,
  /^\.oxlintrc\.json$/,
  /^\.oxlintignore$/,
  /^biome\.json$/,
  /^eslint\.config\.js$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^scripts\//,
  /^tsconfig.*\.json$/,
]

/** True when `arg` is one of the recognized scope flags. */
export function isScopeFlag(arg: string): boolean {
  return SCOPE_FLAGS.includes(arg)
}

/**
 * Resolve the scope mode from a runner's argv. `--all` wins, then `--staged`;
 * everything else — including `--modified`, its alias `--changed`, and no flag
 * at all — is the working-tree modified scope.
 */
export function resolveScopeMode(argv: readonly string[]): ScopeMode {
  if (argv.includes('--all')) {
    return 'all'
  }
  if (argv.includes('--staged')) {
    return 'staged'
  }
  return 'modified'
}

/**
 * Explicit positional file paths, which win over every scope mode including
 * `--all`. `git diff` never surfaces an untracked file, so a brand-new file
 * passed on argv would otherwise be silently dropped from the scope while the
 * run still reported success. Anything not starting with `-` is a path.
 */
export function resolveExplicitFiles(argv: readonly string[]): string[] {
  return argv.filter(a => !a.startsWith('-'))
}

/**
 * Newline-split `git` porcelain output, run with array args so there is no
 * shell and no injection surface. Empty on a non-zero status, so callers fail
 * open to a broad scope rather than silently checking nothing.
 */
function gitFiles(args: readonly string[]): string[] {
  const result = spawnSync('git', [...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    return []
  }
  return result.stdout
    .split('\n')
    .map(s => s.trim())
    .filter(s => !!s.length)
}

/**
 * Paths staged for the next commit (Added/Copied/Modified/Renamed). The
 * pre-commit and `--staged` lanes scope to exactly this set, so a run touches
 * only what is being committed.
 */
export function getStagedFiles(): string[] {
  return gitFiles(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
}

/**
 * Paths modified in the working tree vs HEAD — the local-dev `--modified`
 * scope, with the same ACMR filter as {@link getStagedFiles}.
 */
export function getModifiedFiles(): string[] {
  return gitFiles(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'])
}

/** The file list for a scope mode. `all` is handled by the caller, not here. */
export function getScopedFiles(mode: ScopeMode): string[] {
  return mode === 'staged' ? getStagedFiles() : getModifiedFiles()
}

/**
 * Every file the repository owns: tracked, plus untracked files that
 * .gitignore does not exclude. This is the whole-workspace scope for a tool
 * that does not read .gitignore itself, so build output under `dist/` and the
 * vendored trees under `external/` stay out of the gate. Gating on generated
 * bytes means a fresh clone and a built checkout disagree about whether the
 * repo is clean.
 */
export function listWorkspaceFiles(): string[] {
  return gitFiles(['ls-files', '--cached', '--others', '--exclude-standard'])
}

/**
 * Keep the files whose extension is in `extensions` and that still exist on
 * disk. A rename or a delete can leave a git-derived path pointing at nothing.
 */
export function filterByExtension(
  files: readonly string[],
  extensions: ReadonlySet<string>,
): string[] {
  return files.filter(f => extensions.has(path.extname(f)) && existsSync(f))
}

/** True when any of `files` matches an escalation pattern. Pure. */
export function touchesEscalationPath(files: readonly string[]): boolean {
  return files.some(f =>
    ESCALATION_PATTERNS.some(pattern => pattern.test(f.replaceAll('\\', '/'))),
  )
}

/**
 * Whether a run in `mode` over `files` escalates to a full-workspace run.
 * `staged` NEVER escalates: the pre-commit hook must stay fast, so it scopes
 * strictly to the staged files no matter which config paths they touch. The
 * whole-tree net for such a change is CI and `pnpm run check --all`, not the
 * commit hook.
 */
export function escalatesForScope(
  mode: ScopeMode,
  files: readonly string[],
): boolean {
  if (mode === 'staged') {
    return false
  }
  return touchesEscalationPath(files)
}

/**
 * The zero-scope verdict. A run whose scope resolved to no files checked
 * nothing, and that has to read differently from a pass. Pure — exported for
 * tests.
 */
export function zeroScopeNotice(scopeLabel: string, command: string): string {
  return (
    '0 files checked — this is NOT a pass. ' +
    `Scope ${scopeLabel.toUpperCase()} resolved to no lintable files.\n` +
    `For the whole-tree verdict: pnpm run ${command} --all`
  )
}

/**
 * The reminder printed after every scoped `--fix` run. A fix outside `--all`
 * only touches the files git already sees as changed, so a repo-wide autofix
 * campaign run that way is a silent no-op on the whole backlog. Pure —
 * exported for tests.
 */
export function fixScopeReminder(scopeLabel: string): string {
  return (
    `fix applied to ${scopeLabel.toUpperCase()} files only — the repo-wide backlog is untouched.\n` +
    'For the whole tree: pnpm run fix --all'
  )
}
