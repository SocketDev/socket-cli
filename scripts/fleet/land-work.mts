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

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  GENERATED_PATTERNS,
  isBothTouched,
  isGenerated,
  isUnmerged,
} from '../../.claude/hooks/fleet/_shared/landable.mts'
import { parsePorcelain } from './_shared/git-porcelain.mts'
import { summarizeGroups } from './land-work/ai-summary.mts'
import { commitMessage } from './land-work/message.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { REPO_ROOT } from './paths.mts'

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
  for (
    let i = 0, { length } = UNTRACKED_BY_DEFAULT_PREFIXES;
    i < length;
    i += 1
  ) {
    const prefix = UNTRACKED_BY_DEFAULT_PREFIXES[i]!
    if (np.startsWith(prefix)) {
      return true
    }
  }
  // A path segment (anchored at start or after `/`) ending in `-bundled` or
  // `-vendored`, followed by `/` or end-of-string.
  return /(?:^|\/)[^/]+-(?:bundled|vendored)(?:\/|$)/.test(np)
}

export function isSourceArea(p: string): boolean {
  const np = normalizePath(p)
  for (let i = 0, { length } = SOURCE_AREA_PREFIXES; i < length; i += 1) {
    const prefix = SOURCE_AREA_PREFIXES[i]!
    if (np.startsWith(prefix)) {
      return true
    }
  }
  return false
}

// Porcelain parsing lives in _shared/git-porcelain.mts (parsePorcelain) —
// re-exported here so land-work's tests and the Stop hook keep one import
// site while the parse logic stays single-sourced.
export { parsePorcelain } from './_shared/git-porcelain.mts'

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
  const scopes = [...byScope.keys()].toSorted()
  for (let i = 0, { length } = scopes; i < length; i += 1) {
    const scope = scopes[i]!
    const sorted = byScope.get(scope)!.slice().toSorted()
    groups.push({ paths: sorted, scope, type: deriveType(sorted) })
  }
  return groups
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
  for (const { path: filePath, status } of entries) {
    if (isUntrackedByDefault(filePath)) {
      skippedForeignTree.push(filePath)
    } else if (isGenerated(filePath)) {
      skippedGenerated.push(filePath)
    } else if (isBothTouched(status)) {
      skippedAmbiguous.push(filePath)
    } else if (isSourceArea(filePath)) {
      landable.push(filePath)
    } else {
      skippedOutsideSource.push(filePath)
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

// The landable-vs-skip classification (isGenerated / isUnmerged / isBothTouched)
// is the single source in _shared/landable.mts — dirty-worktree-stop-guard reads
// the SAME definitions so a path the lander skips is never one the guard demands
// a human commit. Re-exported here so land-work's own callers/tests keep their
// import site.
export { GENERATED_PATTERNS, isBothTouched, isGenerated, isUnmerged }

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

function landGroup(
  cwd: string,
  group: CommitGroup,
  aiSummary?: string | undefined,
): boolean {
  const message = commitMessage(group, aiSummary)
  // `-A -- <paths>` so a DELETED path stages as a deletion — plain `git add`
  // errors "pathspec did not match" on removed files (cascade tombstones,
  // pruned hooks), stranding the whole group. Scoped to the pathspec, so it
  // stays surgical (same rationale as the cascade's stagePaths). Advisory:
  // when a path's deletion is ALREADY staged nothing on disk matches the
  // pathspec and the add errors spuriously, while `git commit -o` below
  // commits the named paths' working-tree state without needing the index —
  // so a real problem surfaces as the commit failure, not the add.
  git(cwd, ['add', '-A', '--', ...group.paths])
  const committed = git(cwd, [
    'commit',
    '-o',
    ...group.paths,
    '-S',
    '-m',
    message,
  ])
  if (!committed.ok) {
    logger.fail(`git commit failed for ${group.scope}: ${committed.out.trim()}`)
    return false
  }
  logger.success(`landed ${message.split('\n')[0]}`)
  return true
}

export async function main(cwd: string = REPO_ROOT): Promise<number> {
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
    const pList = partition.skippedAmbiguous.slice(0, 10)
    for (let i = 0, { length } = pList; i < length; i += 1) {
      const p = pList[i]!
      logger.substep(p)
    }
  }
  // Only surface out-of-source paths in whole-tree mode; in restricted mode the
  // caller already chose the exact set, so other dirty paths aren't its concern.
  if (!restricted && partition.skippedOutsideSource.length) {
    logger.warn(
      `${partition.skippedOutsideSource.length} dirty path(s) outside source areas — NOT landed, review manually:`,
    )
    const ps = partition.skippedOutsideSource.slice(0, 10)
    for (let i = 0, { length } = ps; i < length; i += 1) {
      const p = ps[i]!
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
  // Mark the run so the AI summarizer's headless child — which inherits this
  // env and loads this repo's Stop hook — never re-triggers auto-land on the
  // still-dirty tree (auto-land-on-stop skips when this is set).
  process.env['SOCKET_LAND_WORK_ACTIVE'] = '1'
  // Deterministic subject + file digest always stand; the floor-tier AI summary
  // is pure enrichment the land never waits on (empty map = digest-only body).
  const summaries = await summarizeGroups(cwd, groups)
  let failed = 0
  for (const g of groups) {
    if (!landGroup(cwd, g, summaries.get(g.scope))) {
      failed += 1
    }
  }
  return failed === 0 ? 0 : 1
}

if (isMainModule(import.meta.url)) {
  main().then(
    code => {
      process.exitCode = code
    },
    () => {
      process.exitCode = 1
    },
  )
}
