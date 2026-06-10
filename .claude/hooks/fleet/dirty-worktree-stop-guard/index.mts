#!/usr/bin/env node
// Claude Code Stop hook — dirty-worktree-stop-guard.
//
// renamed-from: dirty-worktree-stop-reminder
//
// Fires at turn-end. Checks `git status --porcelain` in the harness
// project dir. If anything is modified, untracked, or staged but
// uncommitted, it BLOCKS the stop (Stop-hook `{decision:'block'}`) so
// the agent must resolve the dirty state — commit it, revert what it
// didn't author, or explicitly announce an intentional pause — before
// ending the turn.
//
// The fleet rule (CLAUDE.md "Don't leave the worktree dirty"):
//
//   Finish a code change → commit it. Never end a turn with
//   uncommitted edits, untracked files, or staged-but-uncommitted
//   hunks. "Done" means committed.
//
// Why a BLOCK, not a reminder: a stderr nudge at turn-end is easy to
// scroll past, so dirty worktrees still leaked into the next session.
// A Stop-hook block re-prompts the model to finish the job (commit /
// revert / announce) before it can stop. The block is suppressed when
// Claude Code reports `stop_hook_active: true`, so it fires at most
// once per turn and can't loop.
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
// Fail-open: any error in the hook exits 0 (a guard bug must not wedge
// every Stop).

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'

import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow dirty-worktree bypass'

interface StopPayload {
  readonly transcript_path?: string | undefined
  readonly stop_hook_active?: boolean | undefined
}

export async function readStdinRaw(): Promise<string> {
  return await new Promise<string>(resolve => {
    let chunks = ''
    process.stdin.on('data', d => {
      chunks += d.toString('utf8')
    })
    process.stdin.on('end', () => resolve(chunks))
    process.stdin.on('error', () => resolve(chunks))
    // .unref() so this fallback timer can't keep the event loop alive past
    // the work — a Stop hook must exit deterministically (it's spawned once
    // per turn, and under `node --test --test-isolation=process` a live timer
    // hangs the runner waiting on a child that never drains).
    setTimeout(() => resolve(chunks), 200).unref()
  })
}

export function getProjectDir(): string | undefined {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

/**
 * True when `dir` is the PRIMARY checkout (not a linked worktree). In a linked
 * worktree `git rev-parse --git-dir` resolves under `.git/worktrees/<name>`; in
 * the primary it's the repo's own `.git`. Mirrors `primary-checkout-branch-guard`.
 */
export function isPrimaryCheckout(dir: string): boolean {
  const r = spawnSync('git', ['rev-parse', '--git-dir'], {
    cwd: dir,
    timeout: 5_000,
  })
  if (r.status !== 0) {
    // Not a git repo (or git unavailable) — nothing to guard, treat as
    // non-primary so the hook stays out of the way (fail-open).
    return false
  }
  const gitDir = String(r.stdout).trim().replace(/\\/g, '/')
  return !gitDir.includes('/.git/worktrees/')
}

interface DirtyEntry {
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
    entries.push({ status, path: filePath })
  }
  return entries
}

export function listDirtyEntries(repoDir: string): DirtyEntry[] {
  const r = spawnSync('git', ['status', '--porcelain'], {
    cwd: repoDir,
    timeout: 5_000,
  })
  if (r.status !== 0) {
    return []
  }
  return parsePorcelain(String(r.stdout))
}

export function formatDirtyBlock(dirty: readonly DirtyEntry[]): string {
  const lines = [
    `[dirty-worktree-stop-guard] Turn ended with ${dirty.length} dirty path(s) in the primary checkout:`,
  ]
  for (const e of dirty.slice(0, 10)) {
    lines.push(`  ${e.status} ${e.path}`)
  }
  if (dirty.length > 10) {
    lines.push(`  ... and ${dirty.length - 10} more`)
  }
  lines.push(
    '',
    "Fleet rule: end-of-turn worktree must match the user's mental model",
    "of where the work is. 'Done' means committed. Resolve before stopping:",
    '  • Commit the dirty paths (surgical: `git commit -o <file>`).',
    '  • Revert paths you did not author this session.',
    '  • Genuinely cannot commit yet (mid-refactor, waiting on user)? Say so',
    `    explicitly, OR type \`${BYPASS_PHRASE}\` to end the turn dirty.`,
    '  • Stacking WIP to defer the gates? Do it in a linked git worktree',
    '    (`git commit --no-verify` there) — this guard only blocks the primary.',
    '',
    'See CLAUDE.md → "Don\'t leave the worktree dirty" + docs/agents.md/fleet/worktree-hygiene.md.',
  )
  return lines.join('\n')
}

export interface StopInputs {
  readonly dirtyCount: number
  readonly isPrimary: boolean
  readonly bypassPresent: boolean
  readonly stopHookActive: boolean
}

// The decision outcomes:
//   'allow'         — clean tree: stop freely, no output.
//   'note-worktree' — dirty linked worktree: informational note, no block.
//   'note-bypass'   — dirty primary + bypass phrase: informational note, no block.
//   'note-active'   — dirty primary, would block, but stop_hook_active is set
//                     (a block already fired this turn) → degrade to a note to
//                     avoid a loop.
//   'block'         — dirty primary, no escape: emit the Stop block decision.
export type StopAction =
  | 'allow'
  | 'note-active'
  | 'note-bypass'
  | 'note-worktree'
  | 'block'

/**
 * The pure decision: given the resolved git + payload facts, what should the
 * Stop hook do? Kept side-effect-free so it unit-tests directly — no spawn, no
 * git, no subprocess race.
 */
export function decideStopAction(inputs: StopInputs): StopAction {
  if (inputs.dirtyCount === 0) {
    return 'allow'
  }
  if (!inputs.isPrimary) {
    return 'note-worktree'
  }
  if (inputs.bypassPresent) {
    return 'note-bypass'
  }
  if (inputs.stopHookActive) {
    return 'note-active'
  }
  return 'block'
}

async function main(): Promise<void> {
  const payloadRaw = await readStdinRaw()
  let payload: StopPayload = {}
  try {
    payload = JSON.parse(payloadRaw) as StopPayload
  } catch {
    // No / malformed payload — nothing to key the bypass + loop-guard
    // off; fall through with empty payload (treated as no bypass, not
    // already-active).
  }

  const repoDir = getProjectDir()
  if (!repoDir) {
    return
  }

  const dirty = listDirtyEntries(repoDir)
  const action = decideStopAction({
    dirtyCount: dirty.length,
    isPrimary: isPrimaryCheckout(repoDir),
    bypassPresent: bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE),
    stopHookActive: payload.stop_hook_active === true,
  })

  if (action === 'allow') {
    return
  }
  if (action === 'note-worktree') {
    process.stderr.write(
      `[dirty-worktree-stop-guard] ${dirty.length} dirty path(s) in a linked worktree — ` +
        'commit when ready (`git commit --no-verify` to defer the gates here).\n',
    )
    return
  }
  if (action === 'note-bypass') {
    process.stderr.write(
      `[dirty-worktree-stop-guard] ${dirty.length} dirty path(s); ` +
        `allowed by \`${BYPASS_PHRASE}\`.\n`,
    )
    return
  }

  const message = formatDirtyBlock(dirty)
  if (action === 'note-active') {
    process.stderr.write(message + '\n')
    return
  }
  process.stdout.write(
    JSON.stringify({ decision: 'block', reason: message }) + '\n',
  )
}

// Run, then exit DETERMINISTICALLY: a Stop hook must not depend on the event
// loop draining (open stdin listeners / timers would hang the harness + the
// node --test runner). All `return` paths above fall through to exit 0; a
// block writes its stdout JSON then exits 0 too (the decision is in the JSON,
// not the exit code).
main()
  .then(() => process.exit(0))
  .catch(e => {
    process.stderr.write(
      `[dirty-worktree-stop-guard] hook bug — fail-open. ${e instanceof Error ? e.message : String(e)}\n`,
    )
    process.exit(0)
  })
