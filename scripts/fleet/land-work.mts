/**
 * @file Land-work — group the dirty working tree into logical commits and land
 *   them to local main, surgically. The fleet biases toward landing often:
 *   less ambiguous dirty state means fewer phantom-collision stalls, and a
 *   session's own uncommitted work is banked before compaction erases the
 *   memory of it.
 *   Grouping is deterministic (scope + type derived from each path), so a
 *   re-run produces the same plan and any session — running the same hooks —
 *   can recognize an auto-landed commit as a logical grouping rather than a
 *   rival's work (see docs/agents.md/fleet/parallel-claude-sessions.md ->
 *   "Auto-landed commits are expected").
 *   Safety: dry-run by default (prints the plan). `--commit` lands each group
 *   via `git add -- <paths>` + `git commit -o <paths> -S` (surgical, signed —
 *   never `-A`, never a bare commit). Only paths under known SOURCE areas are
 *   landed; untracked-by-default trees (vendor/build/etc.) and anything outside
 *   the source allowlist are surfaced as "not landed" rather than swept in.
 *   Landing is recoverable (a local commit amends / resets to HEAD~); this
 *   never runs a destructive git op.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

// Path prefixes that are expected to be dirty and are never landed here (kept
// in lock-step with foreign-paths.mts / dirty-worktree-stop-guard).
const UNTRACKED_BY_DEFAULT_PREFIXES = [
  'additions/source-patched/',
  'deps/',
  'external/',
  'pkg-node/',
  'third_party/',
  'upstream/',
  'vendor/',
]

// Top-level source areas land-work is willing to commit. Anything outside these
// (a stray file at the repo root, a runtime artifact) is surfaced, not landed.
const SOURCE_AREA_PREFIXES = [
  '.claude/',
  '.config/',
  '.github/',
  'docs/',
  'packages/',
  'scripts/',
  'src/',
  'template/',
  'test/',
]

export interface DirtyPath {
  readonly path: string
  readonly status: string
}

export interface CommitGroup {
  readonly paths: readonly string[]
  readonly scope: string
  readonly type: string
}

interface GitRun {
  readonly ok: boolean
  readonly out: string
}

function isUntrackedByDefault(p: string): boolean {
  const np = normalizePath(p)
  for (const prefix of UNTRACKED_BY_DEFAULT_PREFIXES) {
    if (np.startsWith(prefix)) {
      return true
    }
  }
  return /(?:^|\/)[^/]+-(?:bundled|vendored)(?:\/|$)/.test(np)
}

export function isSourceArea(p: string): boolean {
  const np = normalizePath(p)
  for (const prefix of SOURCE_AREA_PREFIXES) {
    if (np.startsWith(prefix)) {
      return true
    }
  }
  return false
}

/**
 * Parse `git status --porcelain` into dirty entries. Rename entries
 * (`R old -> new`) resolve to the new path. Pure.
 */
export function parsePorcelain(out: string): DirtyPath[] {
  const entries: DirtyPath[] = []
  for (const line of out.split('\n')) {
    if (!line) {
      continue
    }
    const status = line.slice(0, 2)
    const rest = line.slice(3)
    const arrow = rest.indexOf(' -> ')
    const path = arrow === -1 ? rest : rest.slice(arrow + 4)
    entries.push({ path, status })
  }
  return entries
}

/**
 * Derive a commit scope from a path. `template/base/<rest>` mirrors the live
 * tree, so it recurses on `<rest>`. Pure.
 */
export function deriveScope(p: string): string {
  let rest = normalizePath(p)
  if (rest.startsWith('template/base/')) {
    rest = rest.slice('template/base/'.length)
  }
  if (rest.startsWith('.claude/hooks/')) {
    return 'hooks'
  }
  if (rest.startsWith('.claude/skills/')) {
    return 'skills'
  }
  if (rest.startsWith('.claude/')) {
    return 'claude'
  }
  if (rest.startsWith('.config/')) {
    return 'config'
  }
  if (rest.startsWith('.github/')) {
    return 'ci'
  }
  if (rest.startsWith('docs/')) {
    return 'docs'
  }
  if (rest.startsWith('scripts/fleet/')) {
    return 'fleet'
  }
  if (rest.startsWith('scripts/')) {
    return 'scripts'
  }
  if (rest.startsWith('test/')) {
    return 'test'
  }
  const pkg = /^packages\/((?:@[^/]+\/)?[^/]+)\//.exec(rest)
  if (pkg) {
    return pkg[1]!
  }
  const seg = rest.split('/')[0]!
  return seg.replace(/\.[^.]+$/, '') || 'repo'
}

/**
 * Derive a Conventional-Commit type for a homogeneous group. `test` when every
 * path is a test, `docs` when every path is markdown/docs, else `chore` — the
 * honest type for an auto-landing (a semantic feat/fix is a human's call).
 * Pure.
 */
export function deriveType(paths: readonly string[]): string {
  const isTest = (p: string): boolean =>
    /(?:^|\/)test\//.test(p) || /\.test\.[cm]?[jt]s$/.test(p)
  const isDoc = (p: string): boolean =>
    p.endsWith('.md') || /(?:^|\/)docs\//.test(p)
  if (paths.every(isTest)) {
    return 'test'
  }
  if (paths.every(isDoc)) {
    return 'docs'
  }
  return 'chore'
}

/**
 * Group landable paths into commits keyed by scope. Each group's type is
 * derived from its members. Groups + their paths are sorted for determinism.
 * Pure.
 */
export function groupPaths(paths: readonly string[]): CommitGroup[] {
  const byScope = new Map<string, string[]>()
  for (const p of paths) {
    const scope = deriveScope(p)
    const list = byScope.get(scope)
    if (list) {
      list.push(p)
    } else {
      byScope.set(scope, [p])
    }
  }
  const groups: CommitGroup[] = []
  for (const scope of [...byScope.keys()].sort()) {
    const sorted = byScope.get(scope)!.slice().sort()
    groups.push({ paths: sorted, scope, type: deriveType(sorted) })
  }
  return groups
}

export function commitMessage(group: CommitGroup): string {
  const n = group.paths.length
  return `${group.type}(${group.scope}): land ${n} ${group.scope} change${n === 1 ? '' : 's'}`
}

export interface PartitionedTree {
  readonly landable: string[]
  readonly skippedAmbiguous: string[]
  readonly skippedForeignTree: string[]
  readonly skippedGenerated: string[]
  readonly skippedOutsideSource: string[]
}

/**
 * Split dirty entries into: landable source paths; vendored/build trees;
 * generated (machine-written) files; ambiguous both-touched paths (concurrent
 * index+worktree — a `git add` would blend hunks); and out-of-source paths.
 * Only `landable` is ever auto-committed. Pure.
 */
export function partitionTree(entries: readonly DirtyPath[]): PartitionedTree {
  const landable: string[] = []
  const skippedAmbiguous: string[] = []
  const skippedForeignTree: string[] = []
  const skippedGenerated: string[] = []
  const skippedOutsideSource: string[] = []
  for (const { path, status } of entries) {
    if (isUntrackedByDefault(path)) {
      skippedForeignTree.push(path)
    } else if (isGenerated(path)) {
      skippedGenerated.push(path)
    } else if (isBothTouched(status)) {
      skippedAmbiguous.push(path)
    } else if (isSourceArea(path)) {
      landable.push(path)
    } else {
      skippedOutsideSource.push(path)
    }
  }
  return {
    landable,
    skippedAmbiguous,
    skippedForeignTree,
    skippedGenerated,
    skippedOutsideSource,
  }
}

function git(cwd: string, args: readonly string[]): GitRun {
  // stdioString:false → Buffers, NOT a trimmed string. `git status --porcelain`
  // encodes the staged/unstaged state in the FIRST two columns, and the
  // unstaged form starts with a space (` M path`); the default stdioString
  // trims leading whitespace, eating that space on the first line and shifting
  // every parsed path left by one char. Read raw and stringify ourselves.
  const r = spawnSync('git', args as string[], {
    cwd,
    stdioString: false,
    timeout: 60_000,
  })
  return {
    ok: r.status === 0,
    out: `${String(r.stdout ?? '')}${String(r.stderr ?? '')}`,
  }
}

/**
 * True for a porcelain status that marks an UNMERGED (conflicted) path:
 * any `U`, or the both-added/both-deleted pairs `AA`/`DD`. Never auto-commit
 * one — an unresolved conflict must be resolved by a human, not landed. Pure.
 */
export function isUnmerged(status: string): boolean {
  return status.includes('U') || status === 'AA' || status === 'DD'
}

/**
 * True when a porcelain status shows BOTH an index change AND a worktree change
 * (e.g. `MM`, `AM`, `RM`): the staged blob and the on-disk file differ, so a
 * `git add` before commit would fold in whatever is unstaged — possibly a
 * concurrent session's hunks to a file both touched. The auto-lander skips
 * these (surfaces for manual review) rather than blend authorship. `??`
 * (untracked) is not both-touched. Pure.
 */
export function isBothTouched(status: string): boolean {
  const index = status[0] ?? ' '
  const worktree = status[1] ?? ' '
  return index !== ' ' && index !== '?' && worktree !== ' ' && worktree !== '?'
}

// Tracked-but-generated paths that live inside source areas yet are never
// hand-authored — a formatter/build/lockfile step writes them. The auto-lander
// must not commit them just because they're dirty in a source dir.
const GENERATED_PATTERNS = [
  /(?:^|\/)pnpm-lock\.yaml$/,
  /(?:^|\/)_dispatch\/bundle\.cjs$/,
  /(?:^|\/)(?:build|dist|coverage|coverage-isolated)\//,
]

/**
 * True for a tracked-but-generated path (lockfile, hook bundle, build/coverage
 * output) that sits in a source area but is machine-written, not authored.
 * Pure.
 */
export function isGenerated(p: string): boolean {
  const np = normalizePath(p)
  for (const re of GENERATED_PATTERNS) {
    if (re.test(np)) {
      return true
    }
  }
  return false
}

/**
 * The in-progress git operation ('rebase' | 'merge' | 'cherry-pick'), or
 * undefined when the tree is in a normal state. A rebase's dirty files are
 * intentional + fresh (land them), but the operation state is logged so the
 * landing is never silent while git is mid-replay.
 */
function inProgressOp(cwd: string): string | undefined {
  const gitDir = git(cwd, ['rev-parse', '--git-dir'])
  if (!gitDir.ok) {
    return undefined
  }
  const dir = path.resolve(cwd, gitDir.out.trim())
  if (
    existsSync(path.join(dir, 'rebase-merge')) ||
    existsSync(path.join(dir, 'rebase-apply'))
  ) {
    return 'rebase'
  }
  if (existsSync(path.join(dir, 'MERGE_HEAD'))) {
    return 'merge'
  }
  if (existsSync(path.join(dir, 'CHERRY_PICK_HEAD'))) {
    return 'cherry-pick'
  }
  return undefined
}

function landGroup(cwd: string, group: CommitGroup): boolean {
  const added = git(cwd, ['add', '--', ...group.paths])
  if (!added.ok) {
    logger.fail(`git add failed for ${group.scope}: ${added.out.trim()}`)
    return false
  }
  const committed = git(cwd, [
    'commit',
    '-o',
    ...group.paths,
    '-S',
    '-m',
    commitMessage(group),
  ])
  if (!committed.ok) {
    logger.fail(`git commit failed for ${group.scope}: ${committed.out.trim()}`)
    return false
  }
  logger.success(`landed ${commitMessage(group)}`)
  return true
}

export function main(cwd: string = process.cwd()): number {
  const argv = process.argv.slice(2)
  const doCommit = argv.includes('--commit')
  // Non-flag args restrict landing to EXACTLY this set (repo-relative paths).
  // The auto-land Stop-hook passes only the paths THIS session authored, so a
  // foreign staged feature in the shared index is never swept into a commit.
  // No paths given → land the whole dirty tree (manual `land-work` use).
  const restrictTo = new Set(argv.filter(a => !a.startsWith('-')))
  const restricted = restrictTo.size > 0
  // --untracked-files=all lists NEW files individually instead of collapsing a
  // new directory to `?? dir/` — otherwise a fresh source file in a new dir
  // never matches an explicit --paths entry and silently fails to land.
  const status = git(cwd, ['status', '--porcelain', '--untracked-files=all'])
  if (!status.ok) {
    logger.fail('git status failed — not a git repo, or git unavailable.')
    return 1
  }
  const op = inProgressOp(cwd)
  if (op) {
    logger.info(
      `A ${op} is in progress — landing its fresh source files; unmerged conflicts are skipped.`,
    )
  }
  const allEntries = parsePorcelain(status.out)
  if (allEntries.length === 0) {
    logger.log('Working tree clean — nothing to land.')
    return 0
  }
  // Never auto-commit an unresolved conflict — a human resolves those.
  const unmerged = allEntries.filter(e => isUnmerged(e.status))
  if (unmerged.length) {
    logger.warn(
      `Skipping ${unmerged.length} unmerged/conflicted path(s) — resolve by hand.`,
    )
  }
  const entries = allEntries.filter(e => !isUnmerged(e.status))
  const partition = partitionTree(entries)
  const { skippedForeignTree } = partition
  const landable = restricted
    ? partition.landable.filter(p => restrictTo.has(p))
    : partition.landable
  if (skippedForeignTree.length) {
    logger.info(
      `Skipping ${skippedForeignTree.length} vendored/build path(s) (expected dirty).`,
    )
  }
  if (partition.skippedGenerated.length) {
    logger.info(
      `Skipping ${partition.skippedGenerated.length} generated path(s) (lockfile/bundle/build).`,
    )
  }
  if (partition.skippedAmbiguous.length) {
    logger.warn(
      `Skipping ${partition.skippedAmbiguous.length} both-touched path(s) (staged + unstaged — a git add could blend a co-tenant's hunks); land by hand:`,
    )
    for (const p of partition.skippedAmbiguous.slice(0, 10)) {
      logger.substep(p)
    }
  }
  // Only surface out-of-source paths in whole-tree mode; in restricted mode the
  // caller already chose the exact set, so other dirty paths aren't its concern.
  if (!restricted && partition.skippedOutsideSource.length) {
    logger.warn(
      `${partition.skippedOutsideSource.length} dirty path(s) outside source areas — NOT landed, review manually:`,
    )
    for (const p of partition.skippedOutsideSource.slice(0, 10)) {
      logger.warn(`  ${p}`)
    }
  }
  if (landable.length === 0) {
    logger.log('No landable source changes.')
    return 0
  }
  const groups = groupPaths(landable)
  if (!doCommit) {
    logger.log(`Plan: ${groups.length} logical commit(s) (dry-run):`)
    for (const g of groups) {
      logger.log(`  ${commitMessage(g)}`)
      for (const p of g.paths) {
        logger.log(`      ${p}`)
      }
    }
    logger.log('Re-run with --commit to land.')
    return 0
  }
  let failed = 0
  for (const g of groups) {
    if (!landGroup(cwd, g)) {
      failed += 1
    }
  }
  return failed === 0 ? 0 : 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
