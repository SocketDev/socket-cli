#!/usr/bin/env node
// Claude Code Stop hook — dirty-worktree-stop-guard.
//
// renamed-from: dirty-worktree-stop-nudge
//
// Fires at turn-end. Checks `git status --porcelain` in the harness
// project dir, scoped to the paths THIS session authored (transcript +
// same-turn ledger). If anything the turn touched is modified,
// untracked, or staged but uncommitted, it BLOCKS the stop (guard
// `block()` verdict) so the agent must resolve the dirty state — commit
// it, revert what it didn't author, or explicitly announce an
// intentional pause — before ending the turn.
//
// The scoping matters under parallel sessions (CLAUDE.md "Multiple
// Claude sessions may target one checkout"): a turn that worked in a
// sibling repo must not be blamed for another agent's in-flight dirt in
// this checkout. Both the primary checkout and sibling repos are scoped
// the same way — only session-touched paths count.
//
// Active-edits ledger integration (#239): dirty paths whose MOST RECENT
// ledger writer is a DIFFERENT live actor (a separate interactive session,
// within LEDGER_TTL_MS) are SANCTIONED — listed under a separate heading and
// excluded from the blocking count. When every dirty path in THIS session's
// touch set is sanctioned, the hook exits clean.
//
// Live background child (#206): a spawned subagent's edits DON'T get a distinct
// ledger actor — Claude Code hands PostToolUse the parent's transcript_path, so
// they collapse into this session's ledger and can't be sanctioned per-path.
// Instead, when a subagent transcript under `<session>/subagents/` was appended
// to within CHILD_LIVE_WINDOW_MS, the guard DEFERS (block → note): forcing a
// commit mid-refactor would land a half-done change, and the child's completion
// notification re-invokes the session to land the work. No promissory prose
// needed in either case.
//
// The fleet rule (CLAUDE.md "Don't leave the worktree dirty"):
//
//   Finish a code change → commit it. Never end a turn with
//   uncommitted edits, untracked files, or staged-but-uncommitted
//   hunks. "Done" means committed.
//
// Why a BLOCK, not a reminder: a stderr nudge at turn-end is easy to
// scroll past, so dirty worktrees still leaked into the next session.
// A block re-prompts the model to finish the job (commit / revert /
// announce) before it can stop. The block is suppressed when Claude
// Code reports `stop_hook_active: true`, so it fires at most once per
// turn and can't loop — that case degrades to a non-blocking notice.
//
// Three escapes (any one allows the stop):
//   1. Clean worktree — nothing to do.
//   2. In a LINKED git worktree — a worktree is a staging area for a
//      push to main; you may stack WIP there and defer the
//      commit-discipline gates to the end via `git commit --no-verify`.
//      The guard only blocks in the PRIMARY checkout.
//   3. The user typed `Allow dirty-worktree bypass` this turn — for the
//      rare legit can't-commit-yet case in the primary checkout.
//
// Complements `no-orphaned-staging` (index entries only). This hook
// catches the broader dirty-worktree case: unstaged modifications and
// untracked files.
//
// Untracked-by-default directories (vendor/, third_party/, upstream/,
// additions/source-patched/) are filtered out — they're under
// .gitignore rules and not the failure mode this hook targets.
//
// Auto-lander lock-step (_shared/landable.mts): a path the auto-lander
// (land-work.mts) will not hand-commit — generated (lockfile, hook bundle,
// build/coverage output), unmerged (conflict), or both-touched (staged +
// worktree differ) — is filtered out too. Blocking on one strands the turn
// demanding a `git commit -o` the lander itself refuses; both mechanisms
// read the SAME classifiers so they can't drift.
//
// Fail-open: any error in the hook allows the stop (a guard bug must
// not wedge every Stop) — runGuard swallows throws.

import path from 'node:path'

import { findGitRoot } from '@socketsecurity/lib-stable/git/repo'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  CHILD_LIVE_WINDOW_MS,
  computeActorId,
  hasLiveBackgroundChild,
  isActorLive,
  LEDGER_TTL_MS,
  ledgerFilePath,
  listOtherActorLedgerPaths,
  lookupPath,
  normalizeForLedger,
  pruneLedger,
  readActorLedger,
  resolveStoreRoot,
} from '../_shared/active-edits-ledger.mts'
import { readSessionTouchedPaths } from '../_shared/foreign-paths.mts'
import { isBothTouched, isGenerated, isUnmerged } from '../_shared/landable.mts'
import {
  isParked,
  readParked,
  resolveParkedFile,
} from '../_shared/parked-paths.mts'
import type { ParkedEntry } from '../_shared/parked-paths.mts'
import { block, defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow dirty-worktree bypass'

export function getProjectDir(): string | undefined {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

/**
 * True when `dir` is the PRIMARY checkout (not a linked worktree). In a linked
 * worktree `git rev-parse --git-dir` resolves under `.git/worktrees/<name>`; in
 * the primary it's the repo's own `.git`. Mirrors
 * `primary-checkout-branch-guard`.
 */
export function isPrimaryCheckout(dir: string): boolean {
  const r = spawnSync('git', ['rev-parse', '--git-dir'], {
    cwd: dir,
    timeout: spawnTimeoutMs(5000),
  })
  if (r.status !== 0) {
    // Not a git repo (or git unavailable) — nothing to guard, treat as
    // non-primary so the hook stays out of the way (fail-open).
    return false
  }
  const gitDir = normalizePath(String(r.stdout).trim())
  return !gitDir.includes('/.git/worktrees/')
}

export interface DirtyEntry {
  readonly status: string
  readonly path: string
}

// Untracked-by-default path prefixes — match the CLAUDE.md
// "Untracked-by-default for vendored / build-copied trees" list.
const UNTRACKED_BY_DEFAULT_PREFIXES = [
  'additions/source-patched/',
  'vendor/',
  'third_party/',
  'external/',
  'upstream/',
  'deps/',
  'pkg-node/',
]

export function isUntrackedByDefault(p: string): boolean {
  for (
    let i = 0, { length } = UNTRACKED_BY_DEFAULT_PREFIXES;
    i < length;
    i += 1
  ) {
    const prefix = UNTRACKED_BY_DEFAULT_PREFIXES[i]!
    if (p.startsWith(prefix)) {
      return true
    }
  }
  // Match any path segment whose name ends with `-bundled` or `-vendored`, anchored
  // by a slash or string boundary on each side, so `foo-bundled/bar` and `a/b-vendored`
  // both match but `unbundled` does not.
  if (/(?:^|\/)[^/]+-(?:bundled|vendored)(?:\/|$)/.test(p)) {
    return true
  }
  return false
}

export function parsePorcelain(out: string): DirtyEntry[] {
  const entries: DirtyEntry[] = []
  for (const line of out.split('\n')) {
    if (!line) {
      continue
    }
    const status = line.slice(0, 2)
    const rest = line.slice(3)
    const arrow = rest.indexOf(' -> ')
    const filePath = arrow === -1 ? rest : rest.slice(arrow + 4)
    if (isUntrackedByDefault(filePath)) {
      continue
    }
    // Lock-step with the auto-lander (land-work.mts): a path IT would not
    // hand-commit is one this guard must not demand a human commit. It skips
    // generated (machine-written: lockfile, hook bundle, build/coverage),
    // unmerged (conflict — a human resolves, never auto-lands), and both-touched
    // (staged+worktree differ — concurrent authorship it won't blend). Blocking
    // on any of these strands the turn on work `git commit -o` can't cleanly
    // land. Shared classifiers keep the two mechanisms from drifting.
    if (isGenerated(filePath) || isUnmerged(status) || isBothTouched(status)) {
      continue
    }
    entries.push({ status, path: filePath })
  }
  return entries
}

export function listDirtyEntries(repoDir: string): DirtyEntry[] {
  const r = spawnSync('git', ['status', '--porcelain'], {
    cwd: repoDir,
    timeout: spawnTimeoutMs(5000),
  })
  if (r.status !== 0) {
    return []
  }
  return parsePorcelain(String(r.stdout))
}

export interface SiblingDirt {
  readonly root: string
  readonly dirty: readonly DirtyEntry[]
}

/**
 * Dirty paths in SIBLING repos (≠ the primary checkout) that THIS session
 * authored. "Commit as you go" is universal hygiene — it spans every repo the
 * turn touched, not just the harness project dir, and it holds for NON-FLEET
 * siblings too (this guard intentionally does NOT consult `isFleetTarget`).
 * That is the dividing line: behavior/style guards that impose fleet opinions
 * — prefer-undefined-over-null, no-default-export, prefer-primordials — gate on
 * `isFleetTarget` so they never rewrite a non-fleet repo; hygiene guards like
 * this one apply everywhere.
 *
 * Scoped to the session-touched set so a parallel agent's unrelated dirt in the
 * same sibling is never attributed to this turn.
 */
export function listTouchedSiblingDirt(
  touched: ReadonlySet<string>,
  primaryRoot: string,
): SiblingDirt[] {
  if (touched.size === 0) {
    return []
  }
  const touchedByRoot = new Map<string, Set<string>>()
  for (const p of touched) {
    // findGitRoot walks UP to the nearest `.git` (dir or file); it returns the
    // input unchanged when none is found, so a touched path outside any repo
    // resolves to its own dir, fails the git-status probe below, and drops out.
    const root = findGitRoot(path.dirname(p))
    if (root === primaryRoot) {
      continue
    }
    let set = touchedByRoot.get(root)
    if (!set) {
      set = new Set<string>()
      touchedByRoot.set(root, set)
    }
    set.add(p)
  }
  const out: SiblingDirt[] = []
  for (const [root, touchedInRoot] of touchedByRoot) {
    const dirty = listDirtyEntries(root).filter(e =>
      touchedInRoot.has(path.resolve(root, e.path)),
    )
    if (dirty.length) {
      out.push({ root, dirty })
    }
  }
  return out
}

/**
 * Keep only the dirty entries in `repoDir` whose resolved absolute path is in
 * `touched` — the paths THIS session authored. A parallel agent sharing the
 * checkout (CLAUDE.md "Multiple Claude sessions may target one checkout")
 * leaves dirt this turn never touched; scoping to `touched` keeps the guard
 * from forcing the turn to commit or revert another session's in-flight work —
 * the same scoping `listTouchedSiblingDirt` already applies to sibling repos.
 * Pure (no spawn) so it unit-tests directly.
 */
export function filterTouchedDirty(
  dirty: readonly DirtyEntry[],
  repoDir: string,
  touched: ReadonlySet<string>,
): DirtyEntry[] {
  return dirty.filter(e => touched.has(path.resolve(repoDir, e.path)))
}

/**
 * Live-actor classification for a set of dirty paths. Returns two buckets:
 * `blocking` — paths whose most-recent ledger writer is THIS session or
 * unattributed (no live foreign actor has them), and `sanctioned` — paths
 * whose most-recent writer is a DIFFERENT live actor within LEDGER_TTL_MS.
 * Sanctioned paths are excluded from the blocking count so the guard does not
 * force the turn to commit work that belongs to another live run.
 *
 * Fail-safe toward blocking: any IO / parse error reading the ledger counts
 * the path as blocking (not sanctioned).
 */
export interface LedgerPartition {
  readonly blocking: readonly DirtyEntry[]
  readonly sanctioned: readonly SanctionedEntry[]
}

export interface SanctionedEntry {
  readonly entry: DirtyEntry
  readonly ownerActorId: string
}

export function partitionByLedger(
  dirty: readonly DirtyEntry[],
  repoDir: string,
  ownActorId: string | undefined,
  storeRoot: string,
): LedgerPartition {
  if (!ownActorId || dirty.length === 0) {
    return { blocking: dirty, sanctioned: [] }
  }
  const now = Date.now()
  const otherLedgerPaths = listOtherActorLedgerPaths(storeRoot, ownActorId)
  if (otherLedgerPaths.length === 0) {
    return { blocking: dirty, sanctioned: [] }
  }

  // Load all foreign ledgers once — fail-open per file.
  const foreignLedgers: Array<ReturnType<typeof readActorLedger>> = []
  for (let i = 0, { length } = otherLedgerPaths; i < length; i += 1) {
    const raw = readActorLedger(otherLedgerPaths[i]!)
    if (
      raw &&
      raw.actorId !== ownActorId &&
      isActorLive(raw, { now, ttlMs: LEDGER_TTL_MS })
    ) {
      foreignLedgers.push(pruneLedger(raw, { now, ttlMs: LEDGER_TTL_MS }))
    }
  }

  // Read own-actor ledger once for recency comparison. Fail-open (undefined if
  // unreadable): any IO error here defaults to blocking (not sanctioning) because
  // we can't prove foreign recency beats own recency.
  const ownFp = ledgerFilePath(storeRoot, ownActorId)
  const ownLedger = readActorLedger(ownFp)

  const blocking: DirtyEntry[] = []
  const sanctioned: SanctionedEntry[] = []
  for (let i = 0, { length } = dirty; i < length; i += 1) {
    const entry = dirty[i]!
    const abs = path.resolve(repoDir, entry.path)
    const normalized = normalizeForLedger(abs)
    // Own-actor's most-recent write timestamp for this path (undefined if never
    // recorded by us). Used below to determine who is the true most-recent writer.
    const ownWrite = ownLedger ? lookupPath(ownLedger, normalized) : undefined
    // Find the most-recently-writing foreign actor for this path. "First found"
    // is wrong when there are multiple foreign writers or when own actor wrote it
    // more recently — scan all foreign ledgers and take the highest timestamp.
    let foreignLatestTs: number | undefined
    let foreignLatestId: string | undefined
    for (let j = 0, { length: fl } = foreignLedgers; j < fl; j += 1) {
      const ledger = foreignLedgers[j]
      if (!ledger) {
        continue
      }
      const lastWrite = lookupPath(ledger, normalized)
      if (lastWrite !== undefined) {
        if (foreignLatestTs === undefined || lastWrite > foreignLatestTs) {
          foreignLatestTs = lastWrite
          foreignLatestId = ledger.actorId
        }
      }
    }
    // Sanction only when the foreign actor's most-recent write is STRICTLY NEWER
    // than own actor's most-recent write (or own actor never wrote it). If own
    // wrote it at the same time or later, it belongs to us — blocking.
    const foreignIsNewer =
      foreignLatestId !== undefined &&
      foreignLatestTs !== undefined &&
      (ownWrite === undefined || foreignLatestTs > ownWrite)
    if (foreignIsNewer) {
      sanctioned.push({ entry, ownerActorId: foreignLatestId! })
    } else {
      blocking.push(entry)
    }
  }
  return { blocking, sanctioned }
}

export function formatBlock(
  primaryDirty: readonly DirtyEntry[],
  siblingDirt: readonly SiblingDirt[],
  sanctioned?: readonly SanctionedEntry[] | undefined,
): string {
  let total = primaryDirty.length
  for (const s of siblingDirt) {
    total += s.dirty.length
  }
  const lines = [
    `[dirty-worktree-stop-guard] Turn ended with ${total} uncommitted path(s) you authored:`,
  ]
  const groups: Array<{ label: string; dirty: readonly DirtyEntry[] }> = []
  if (primaryDirty.length) {
    groups.push({ label: 'primary checkout', dirty: primaryDirty })
  }
  for (const s of siblingDirt) {
    groups.push({ label: `sibling repo ${s.root}`, dirty: s.dirty })
  }
  for (let i = 0, { length } = groups; i < length; i += 1) {
    const g = groups[i]!
    lines.push(`  ${g.label}:`)
    for (const e of g.dirty.slice(0, 10)) {
      lines.push(`    ${e.status} ${e.path}`)
    }
    if (g.dirty.length > 10) {
      lines.push(`    ... and ${g.dirty.length - 10} more`)
    }
  }
  if (sanctioned && sanctioned.length > 0) {
    lines.push(
      '',
      `  owned by live run — not blocking (${sanctioned.length} path(s)):`,
    )
    for (const s of sanctioned.slice(0, 10)) {
      lines.push(
        `    ${s.entry.status} ${s.entry.path}  [actor: ${s.ownerActorId}]`,
      )
    }
    if (sanctioned.length > 10) {
      lines.push(`    ... and ${sanctioned.length - 10} more`)
    }
  }
  lines.push(
    '',
    'Fleet rule: commit as you go — "done" means committed, in EVERY repo the',
    'turn touched (sibling repos too, fleet or not). Resolve before stopping:',
    '  • Commit the dirty paths in each repo (surgical: `git commit -o <file>`).',
    '  • Revert paths you did not author this session.',
    '  • Genuinely cannot commit yet (mid-refactor, waiting on user)? Say so',
    `    explicitly, OR type \`${BYPASS_PHRASE}\` to end the turn dirty.`,
    '  • Stacking WIP to defer the gates? Do it in a linked git worktree',
    '    (`git commit --no-verify` there).',
    '',
    'See CLAUDE.md → "Don\'t leave the worktree dirty" + docs/agents.md/fleet/worktree-hygiene.md.',
  )
  return lines.join('\n')
}

export interface StopInputs {
  readonly primaryDirtyCount: number
  readonly siblingDirtyCount: number
  readonly isPrimary: boolean
  readonly bypassPresent: boolean
  readonly stopHookActive: boolean
  // True when a spawned subagent is still live (its transcript was appended to
  // recently). A subagent's edits collapse into THIS session's ledger — they
  // can't be sanctioned per-path — so when one is mid-flight the guard defers
  // rather than forcing the turn to commit its in-flight refactor. Optional so
  // existing callers/tests (pre-live-child) keep compiling; absent ⇒ false.
  readonly hasLiveChild?: boolean | undefined
}

// The decision outcomes:
//   'allow'          — nothing this turn left dirty in a blocking spot.
//   'note-worktree'  — only the PRIMARY is dirty and it's a linked worktree
//                      (deferred-WIP staging area), no sibling dirt: note.
//   'note-bypass'    — would block, but the bypass phrase is present: note.
//   'note-active'    — would block, but stop_hook_active is set (a block already
//                      fired this turn) → degrade to a note to avoid a loop.
//   'note-live-child'— would block, but a spawned subagent is still live and its
//                      in-flight edits collapse into this session's set; defer —
//                      the child's completion notification re-invokes the session.
//   'block'          — dirty primary checkout, OR a sibling repo this turn
//                      authored is dirty: emit the block verdict.
export type StopAction =
  | 'allow'
  | 'note-active'
  | 'note-bypass'
  | 'note-live-child'
  | 'note-worktree'
  | 'block'

/**
 * The pure decision: given the resolved git + payload facts, what should the
 * Stop hook do? Kept side-effect-free so it unit-tests directly — no spawn, no
 * git, no subprocess race. A dirty sibling repo (authored this turn) blocks
 * even when the primary is clean or a linked worktree — commit-as-you-go spans
 * repos.
 */
export function decideStopAction(inputs: StopInputs): StopAction {
  const primaryBlocks = inputs.primaryDirtyCount > 0 && inputs.isPrimary
  if (!primaryBlocks && inputs.siblingDirtyCount === 0) {
    // Only escape with no block pending: a dirty PRIMARY that's a linked
    // worktree (deferred-WIP), with no sibling dirt to force the issue.
    if (inputs.primaryDirtyCount > 0 && !inputs.isPrimary) {
      return 'note-worktree'
    }
    return 'allow'
  }
  if (inputs.bypassPresent) {
    return 'note-bypass'
  }
  if (inputs.stopHookActive) {
    return 'note-active'
  }
  if (inputs.hasLiveChild) {
    return 'note-live-child'
  }
  return 'block'
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const repoDir = getProjectDir()
  /* c8 ignore start - getProjectDir() always returns process.cwd() as fallback; this guard is defensive */
  if (!repoDir) {
    return undefined
  }
  /* c8 ignore stop */

  const primaryRoot = findGitRoot(repoDir)
  // One session-touched set drives BOTH arms. The primary checkout is scoped to
  // it just like siblings: when this turn worked in another repo (e.g. a sibling
  // via `gh`/`git -C`), a parallel agent's dirt in THIS checkout was never
  // touched here and must not be blamed on the turn.
  const touched = readSessionTouchedPaths(payload.transcript_path)
  // User-intent HOLD (#238): paths the user parked (recorded via
  // auto-land-on-stop/hold.mts) are sanctioned-dirty — the user explicitly
  // chose to leave them uncommitted, so the guard must not re-block on them
  // every turn. Parked wins before ledger attribution.
  const parkedEntries = readParked(resolveParkedFile(repoDir), {
    now: Date.now(),
  })
  const heldPaths: string[] = []
  const dropParked = (dirty: readonly DirtyEntry[], root: string) =>
    parkedEntries.length === 0
      ? [...dirty]
      : dirty.filter(e => {
          const abs = path.resolve(root, e.path)
          if (isParked(abs, parkedEntries)) {
            heldPaths.push(abs)
            return false
          }
          return true
        })
  const allPrimaryDirty = dropParked(
    filterTouchedDirty(listDirtyEntries(repoDir), repoDir, touched),
    repoDir,
  )

  // Ledger-based sanctioning: split session-touched dirty paths into
  // blocking (ours or unattributed) vs sanctioned (owned by a live foreign
  // actor). Fail-safe toward blocking — any ledger IO error keeps the path
  // in the blocking bucket.
  const ownActorId = computeActorId(payload.transcript_path)
  const storeRoot = resolveStoreRoot(repoDir)
  const { blocking: primaryDirty, sanctioned } = partitionByLedger(
    allPrimaryDirty,
    repoDir,
    ownActorId,
    storeRoot,
  )

  const siblingDirt = listTouchedSiblingDirt(touched, primaryRoot)
    .map(s => ({ ...s, dirty: dropParked(s.dirty, s.root) }))
    .filter(s => s.dirty.length > 0)
  let siblingDirtyCount = 0
  for (const s of siblingDirt) {
    siblingDirtyCount += s.dirty.length
  }
  // `stop_hook_active` is a Stop-payload field absent from ToolCallPayload's
  // declared shape; narrow it defensively off the raw payload.
  const stopHookActive =
    (payload as { stop_hook_active?: unknown | undefined }).stop_hook_active ===
    true
  const action = decideStopAction({
    primaryDirtyCount: primaryDirty.length,
    siblingDirtyCount,
    isPrimary: isPrimaryCheckout(repoDir),
    bypassPresent: bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE),
    stopHookActive,
    hasLiveChild: hasLiveBackgroundChild(payload.transcript_path, {
      now: Date.now(),
      windowMs: CHILD_LIVE_WINDOW_MS,
    }),
  })

  if (action === 'allow') {
    // All session-touched dirty paths are sanctioned — owned by a live foreign
    // actor or parked by explicit user hold. Exit clean; no promissory prose
    // needed — the run's completion notification will re-invoke this session.
    if (sanctioned.length > 0 || heldPaths.length > 0) {
      const parts: string[] = []
      if (sanctioned.length > 0) {
        parts.push(`${sanctioned.length} owned by a live foreign actor`)
      }
      if (heldPaths.length > 0) {
        parts.push(`${heldPaths.length} parked by user hold`)
      }
      return notify(
        `[dirty-worktree-stop-guard] dirty path(s) not blocking: ${parts.join('; ')}.`,
      )
    }
    return undefined
  }
  if (action === 'note-worktree') {
    return notify(
      `[dirty-worktree-stop-guard] ${primaryDirty.length} dirty path(s) in a linked worktree — ` +
        'commit when ready (`git commit --no-verify` to defer the gates here).',
    )
  }
  if (action === 'note-bypass') {
    return notify(
      `[dirty-worktree-stop-guard] uncommitted path(s); ` +
        `allowed by \`${BYPASS_PHRASE}\`.`,
    )
  }
  if (action === 'note-live-child') {
    const deferred = primaryDirty.length + siblingDirtyCount
    return notify(
      `[dirty-worktree-stop-guard] ${deferred} dirty path(s) deferred — a live ` +
        `background child (subagent) is still running; committing its in-flight ` +
        `refactor now would land a half-done change. Its completion notification ` +
        `will re-invoke this session to land the work.`,
    )
  }

  const message = formatBlock(primaryDirty, siblingDirt, sanctioned)
  if (action === 'note-active') {
    return notify(message)
  }
  return block(message)
}

export const hook = defineHook({
  bypass: ['dirty-worktree'],
  bypassMode: 'manual',
  check,
  event: 'Stop',
  type: 'guard',
})
void runHook(hook, import.meta.url)
