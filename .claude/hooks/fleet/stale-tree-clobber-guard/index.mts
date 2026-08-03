#!/usr/bin/env node
// Claude Code PreToolUse hook — stale-tree-clobber-guard.
//
// WHY THIS EXISTS. Three landings on 2026-07-30 silently reverted work
// nobody meant to touch. Two of them ate the same one-line fix
// (`pnpm_config_store_dir`, plus the assertion proving the pin took effect)
// in `.github/actions/fleet/setup-and-install/action.yml` and its
// `template/base/` twin:
//
//   688e1408f  fix(test-collection): conformance-tier files are owned, not orphans
//   e987c0a95  chore(wheelhouse): mirror the skill and doc updates into the live tree
//   6e6c296f0  docs(claude-md): index the persistent sfw CA rule  (same class,
//              different victim: silently dropped 16 lines from
//              docs/agents.md/fleet/adversarial-self-review.md)
//
// None was a blanket sweep. All three were small, scoped, correctly authored
// commits, and `cascade-and-land.mts` already forbids `git add -A`. The
// clobbered paths were never edited by their authors and are nowhere near
// the subject line. What happened is simpler: a session held a working tree
// long enough for another session to land a newer version of a file, then
// committed its own stale copy of that file on top.
//
// The existing staging guards cannot see this. `overeager-staging-guard`
// asks WHOSE file is in the index; this asks WHICH VERSION is in the index.
// A file can be correctly yours, correctly staged, correctly scoped — and
// still be older than HEAD. Note too that `overeager-staging-guard` relaxes
// itself entirely in a `squash-history` repo, which socket-wheelhouse is, so
// nothing was covering this repo. This guard does NOT take that relaxation:
// commit granularity is meaningless under squash, but content loss is
// permanent either way.
//
// DOCTRINE — this adds no new rule, it enforces one already written down.
// See `docs/agents.md/fleet/parallel-claude-sessions.md` ("Reconcile
// FORWARD, never rewind"; "Leave it, or land it") and the squash-history
// advice `.git-hooks/fleet/pre-push.mts` already prints: local main is
// canonical and flattens, so a parallel session's newer content is something
// to LAND, not something to work around, wait out, or revert. Three
// consequences the block message repeats rather than reinventing:
//
//   1. Land forward. Take HEAD's newer version for the paths you did not
//      mean to change, and land everything else in the same breath. Nothing
//      is held back and nothing is reverted.
//   2. Do not hold a working tree across another session's landings. In a
//      land-fast repo the staleness window should barely exist.
//   3. Land the dirty files BEFORE squashing. A squash over an uncommitted
//      tree either sweeps that work under someone else's subject or strands
//      it. Commit first, then squash — never the reverse.
//
// Stashing, branching, waiting for a quiet window, and retreating into a
// private worktree are all the wrong instinct here, and the message says so.
//
// DETECTION. For each staged MODIFICATION, compare the staged blob against
// HEAD's blob for that path:
//
//   Primary, history-free — a deletion-dominant change: it removes at least
//   MIN_DELETED_LINES lines HEAD has and puts back no more than
//   MAX_ADD_RATIO of them. That is "removes content HEAD has, adds nothing
//   in its place". It holds whether or not history survives, which matters
//   because this repo squashes its history flat and a deep per-path walk can
//   return nothing at all.
//
//   Corroboration, bounded and optional — when the staged blob is
//   byte-identical to an older version of that same path within
//   HISTORY_LOOKBACK commits, the rollback is proven rather than inferred.
//   Replayed over the 654 non-revert commits preceding the incident, the
//   corroborated pair fires on 7: the 3 real clobbers above, 2 machine
//   cascade syncs (already exempt via the `FLEET_SYNC=1` sentinel), and 2
//   genuine refactors. Two false positives in 654 commits.
//
//   When the lookback finds NO prior version — history was just flattened —
//   the primary signal stands alone, narrowed to paths this session never
//   authored. An uncorroborated fire on a file you did edit is noise; on a
//   file you never touched it is the exact shape of the bug.
//
// Exempt: the `FLEET_SYNC=1` cascade sentinel (a mirror sync legitimately
// rewrites live files from the template), the `SQUASH_HISTORY=1` sentinel, an
// explicit `revert`-subject commit, a `git revert` in progress, and binary
// blobs. Generated artifacts are not special-cased — they reach the index
// through the cascade, which the sentinel already covers.
//
// Blocks (exit 2). Fails open on hook bugs (exit 0 + stderr log).
//
// Bypass: `Allow stale-tree bypass` in a recent user turn.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash",
//     "tool_input": { "command": "..." },
//     "transcript_path": "/.../session.jsonl" }

import { existsSync } from 'node:fs'
import path from 'node:path'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  extractCommitMessage,
  gitCommitSegments,
  isGitCommit,
} from '../_shared/commit-command.mts'
import { readSessionTouchedPathsDetailed } from '../_shared/foreign-paths.mts'
import { extractGitCwd } from '../_shared/git-cwd.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { isFleetSyncCommand } from '../_shared/shell-command.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'
import { squashSentinelAllows } from '../_shared/squash-sentinel.mts'
import { operatorBypassPresent } from '../_shared/transcript.mts'

import type { ToolCallPayload } from '../_shared/payload.mts'

// Every block path runs through `isGitCommit`, which short-circuits unless
// the raw command contains `git` — a command with no `git` can never block.
export const triggers: readonly string[] = ['git']

const BYPASS_PHRASES = ['Allow stale-tree bypass'] as const

// A change must drop at least this many lines HEAD has before it reads as a
// reversion rather than an ordinary edit. Both action.yml clobbers dropped 71.
export const MIN_DELETED_LINES = 10

// ...and put back no more than this share of them. Both action.yml clobbers
// put back 9 lines against 71 removed (0.13). A rewrite that replaces content
// roughly line-for-line is an edit, not a reversion.
export const MAX_ADD_RATIO = 0.25

// How far back to look for a byte-identical older version of the path.
// Shallow on purpose: history here flattens, so a deep walk buys nothing and
// costs one git process per commit.
export const HISTORY_LOOKBACK = 40

export interface StaleCandidate {
  readonly added: number
  readonly deleted: number
  readonly path: string
  readonly rolledBackTo: string | undefined
}

function git(repoDir: string, args: readonly string[]): string | undefined {
  const result = spawnSync('git', [...args], {
    cwd: repoDir,
    timeout: spawnTimeoutMs(5000),
  })
  if (result.status !== 0) {
    return undefined
  }
  return String(result.stdout)
}

export function getRepoDir(command: string, cwd?: string | undefined): string {
  return extractGitCwd(command, { cwd, subcommand: ['add', 'commit'] })
}

/**
 * True when a `git revert` is mid-flight, the one case where staging an older
 * blob is the whole point. Resolved through `rev-parse --git-path` so a linked
 * worktree's per-worktree gitdir wins.
 */
export function isRevertInProgress(repoDir: string): boolean {
  const out = git(repoDir, ['rev-parse', '--git-path', 'REVERT_HEAD'])
  if (out === undefined) {
    return false
  }
  const gitPath = out.trim()
  if (!gitPath) {
    return false
  }
  return existsSync(
    path.isAbsolute(gitPath) ? gitPath : path.join(repoDir, gitPath),
  )
}

/**
 * Paths named as a pathspec on the `git commit` itself — `-o`/`--only <p>`, or
 * everything after `--`. A pathspec-limited commit records ONLY those paths, so
 * a stale blob sitting elsewhere in the shared index belongs to another session
 * and must not block this commit. An empty result means the commit takes the
 * whole index.
 */
export function commitPathspec(command: string): string[] {
  const paths: string[] = []
  for (const segment of gitCommitSegments(command)) {
    const { args } = segment
    const commitIndex = args.findIndex(a => a === 'commit')
    if (commitIndex === -1) {
      continue
    }
    const rest = args.slice(commitIndex + 1)
    const separator = rest.indexOf('--')
    if (separator !== -1) {
      const afterSeparator = rest.slice(separator + 1)
      for (let i = 0, { length } = afterSeparator; i < length; i += 1) {
        paths.push(afterSeparator[i]!)
      }
    }
    const scan = separator === -1 ? rest : rest.slice(0, separator)
    for (let i = 0, { length } = scan; i < length; i += 1) {
      if (scan[i] === '--only' || scan[i] === '-o') {
        const value = scan[i + 1]
        if (value !== undefined && !value.startsWith('-')) {
          paths.push(value)
          i += 1
        }
      }
    }
  }
  return paths
}

/**
 * Staged modifications whose diff against HEAD reads as a reversion:
 * deletion-dominant per MIN_DELETED_LINES / MAX_ADD_RATIO. Additions,
 * deletions, renames and binaries are all out of scope — only an in-place
 * content rollback can silently lose someone else's landed work.
 */
export function listRevertingCandidates(repoDir: string): StaleCandidate[] {
  const numstat = git(repoDir, [
    'diff',
    '--cached',
    '--numstat',
    '--diff-filter=M',
  ])
  if (numstat === undefined) {
    return []
  }
  const candidates: StaleCandidate[] = []
  const lines = numstat.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const parts = lines[i]!.split('\t')
    if (parts.length < 3) {
      continue
    }
    const rawAdded = parts[0]!
    const rawDeleted = parts[1]!
    const filePath = parts[2]!
    // `-` in either column marks a binary blob — no line semantics to reason
    // about, and a byte compare would flag every recompressed asset.
    if (rawAdded === '-' || rawDeleted === '-') {
      continue
    }
    const added = Number(rawAdded)
    const deleted = Number(rawDeleted)
    if (!Number.isFinite(added) || !Number.isFinite(deleted)) {
      continue
    }
    if (deleted < MIN_DELETED_LINES || added > deleted * MAX_ADD_RATIO) {
      continue
    }
    candidates.push({ added, deleted, path: filePath, rolledBackTo: undefined })
  }
  return candidates
}

/**
 * Corroboration for one path. `sha` is the short SHA of an older commit whose
 * version of `filePath` is byte-identical to what is staged now, within
 * HISTORY_LOOKBACK — proof of a rollback rather than an inference.
 * `hasHistory` is false when the lookback found no prior version at all, which
 * is what a freshly squashed history looks like.
 */
export function findHistoricalMatch(
  repoDir: string,
  filePath: string,
): { hasHistory: boolean; sha: string | undefined } {
  const stagedBlob = git(repoDir, ['rev-parse', `:${filePath}`])?.trim()
  if (!stagedBlob) {
    return { hasHistory: false, sha: undefined }
  }
  const log = git(repoDir, [
    'rev-list',
    `--max-count=${HISTORY_LOOKBACK}`,
    'HEAD',
    '--',
    filePath,
  ])
  const commits = (log ?? '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
  // commits[0] produced HEAD's version, so a PRIOR version needs 2+ entries.
  const prior = commits.slice(1)
  for (let i = 0, { length } = prior; i < length; i += 1) {
    const commit = prior[i]!
    const blob = git(repoDir, ['rev-parse', `${commit}:${filePath}`])?.trim()
    if (blob && blob === stagedBlob) {
      return { hasHistory: true, sha: commit.slice(0, 9) }
    }
  }
  return { hasHistory: prior.length > 0, sha: undefined }
}

export function checkCommand(command: string, payload: ToolCallPayload) {
  if (!isGitCommit(command)) {
    return undefined
  }
  // The cascade rewrites live files from the template on purpose, in a fresh
  // worktree off origin/main — the same sentinels `overeager-staging-guard`
  // and `no-revert-guard` already honor.
  if (isFleetSyncCommand(command) || squashSentinelAllows(command)) {
    return undefined
  }
  const message = extractCommitMessage(command)
  if (message && /^revert/i.test(message.trimStart())) {
    return undefined
  }
  const repoDir = getRepoDir(command, payload.cwd)
  if (isRevertInProgress(repoDir)) {
    return undefined
  }
  let candidates = listRevertingCandidates(repoDir)
  if (candidates.length === 0) {
    return undefined
  }
  const pathspec = commitPathspec(command)
  if (pathspec.length > 0) {
    const named = new Set(pathspec.map(p => path.normalize(p)))
    candidates = candidates.filter(c => named.has(path.normalize(c.path)))
    if (candidates.length === 0) {
      return undefined
    }
  }
  const { authored } = readSessionTouchedPathsDetailed(payload.transcript_path)
  const flagged: StaleCandidate[] = []
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const candidate = candidates[i]!
    const { hasHistory, sha } = findHistoricalMatch(repoDir, candidate.path)
    if (sha) {
      flagged.push({ ...candidate, rolledBackTo: sha })
      continue
    }
    // No corroboration available. Fire only on a path this session never
    // wrote — an uncorroborated deletion in a file you DID edit is your edit.
    if (!hasHistory && !authored.has(path.resolve(repoDir, candidate.path))) {
      flagged.push(candidate)
    }
  }
  if (flagged.length === 0) {
    return undefined
  }
  const transcriptPath = payload.transcript_path
  if (
    transcriptPath &&
    operatorBypassPresent(transcriptPath, BYPASS_PHRASES, 3)
  ) {
    return undefined
  }
  const shown = flagged.slice(0, 10)
  const restoreArgs = shown
    .slice(0, 4)
    .map(c => c.path)
    .join(' ')
  return block(
    [
      '[stale-tree-clobber-guard] Blocked: staged content is OLDER than HEAD for:',
      '',
      ...shown.map(c =>
        c.rolledBackTo
          ? `    ${c.path}  (-${c.deleted} +${c.added}, byte-identical to ${c.rolledBackTo})`
          : `    ${c.path}  (-${c.deleted} +${c.added}, never edited this session)`,
      ),
      ...(flagged.length > shown.length
        ? [`    ... and ${flagged.length - shown.length} more`]
        : []),
      '',
      '  These are almost certainly not yours to change: they sit outside the',
      '  scope of what you are committing, and your tree went stale for them',
      '  while another session landed a newer version. Committing now reverts',
      '  that work silently.',
      '',
      '  Fix — land FORWARD, never revert. Take HEAD for those paths and land',
      '  your real change in the same breath:',
      `    git restore --source=HEAD --staged --worktree -- ${restoreArgs}${
        flagged.length > 4 ? ' ...' : ''
      }`,
      '    # then re-run your commit',
      '',
      "  A parallel session's newer content is something to LAND, not to work",
      '  around. Do NOT stash, do NOT branch, do NOT wait for a quiet window,',
      '  do NOT retreat into a separate worktree — see',
      '  docs/agents.md/fleet/parallel-claude-sessions.md.',
      '',
      '  If you MEANT to roll these back, say so in the subject (`revert: ...`)',
      '  or have the user type "Allow stale-tree bypass" in chat, then retry.',
    ].join('\n'),
  )
}

export const check = bashGuard(checkCommand)

export const hook = defineHook({
  bypass: ['stale-tree'],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
