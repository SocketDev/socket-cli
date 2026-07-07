#!/usr/bin/env node
// Claude Code PreToolUse hook — parallel-agent-staging-guard.
//
// Blocks git operations that would sweep up or destroy ANOTHER agent's
// in-flight work when foreign dirty paths are present in the checkout.
// "Foreign" = dirty, not authored by this session (transcript touched-
// set), changed recently — see `_shared/foreign-paths.mts`.
//
// Gated operations (only blocked WHEN foreign paths exist):
//   • `git add -A` / `.` / `--all` / `-u` / `--update`  (broad stage)
//   • `git commit -a` / `--all`                          (stage+commit)
//   • `git stash` / `git stash push`                     (hides theirs)
//   • `git reset --hard`                                 (destroys theirs)
//   • `git checkout <branch>` / `git switch <branch>`    (may clobber)
//   • `git restore <path>`                               (reverts theirs)
//
// Surgical `git add <file>` and every op when NO foreign paths are
// present pass through untouched.
//
// Relationship to overeager-staging-guard: that hook owns the GENERAL
// staging-sweep rules regardless of parallel-agent signal — it blocks
// `git add -A` AND a bare `git commit` (no pathspec) whose index holds
// files this session didn't touch, steering to `git commit -o <paths>`.
// This hook adds the parallel-agent-specific destructive-op coverage
// (commit -a / stash / reset --hard / checkout / restore) that the
// general rules don't reach, and only fires when the parallel-agent
// signal is live. On `git add -A` both may fire; their messages are
// written to complement, not contradict (this one names the foreign
// paths). The bare-commit sweep is left to overeager-staging-guard so a
// single shape never double-blocks with two different bypass phrases.
//
// Why this exists (incident, socket-lib): see
// parallel-agent-on-stop-nudge. The Stop reminder surfaces the
// signal; this guard refuses the destructive action before it lands.
//
// Reuses the shared shell AST parser (`_shared/shell-command.mts`) so
// chains / substitution / quoting / `$VAR` indirection can't dodge the
// match (`git $(echo add) -A`, `g=git; $g stash`).
//
// Bypass:
//   • `FLEET_SYNC=1` command prefix — cascade scripts in a fresh
//     worktree off origin/main have no parallel-session hazard.
//   • `Allow parallel-agent-staging bypass` in a recent user turn
//     (case-sensitive) — one action.
//
// Fails open on hook bugs (handled by runGuard). Reads a PreToolUse JSON
// payload from stdin:
//   { "tool_name": "Bash",
//     "tool_input": { "command": "..." },
//     "transcript_path": "/.../session.jsonl" }

import process from 'node:process'

import {
  listForeignDirtyPaths,
  readSessionTouchedPaths,
  recordTouchedFromBash,
} from '../_shared/foreign-paths.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import {
  detectBroadGitAdd,
  findInvocation,
  invocationHasFlag,
} from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASES = ['Allow parallel-agent-staging bypass'] as const

// Pre-flight trigger for the dispatcher: it imports + runs this guard only when
// the raw payload contains at least one of these substrings. Every gated op
// detected by `detectGatedGitOp` runs through `findInvocation`/`commandsFor`
// with `binary: 'git'`, which can match only when the literal `git` token is
// present (a `$VAR`-sourced binary collapses to '' and never equals 'git'). So
// `check` can only ever block when the command contains `git` — making this the
// complete, minimal trigger set.
export const triggers: readonly string[] = ['git']

function getProjectDir(): string {
  // c8 ignore next
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

// Return a short label for the gated op the command performs, or undefined.
// Reuses the shared AST parser — never regex on the raw string.
export function detectGatedGitOp(command: string): string | undefined {
  // Broad `git add -A/./--all/-u` — reuse the canonical detector so this
  // hook and overeager-staging-guard agree on what "broad" means.
  const broadAdd = detectBroadGitAdd(command)
  if (broadAdd) {
    return broadAdd
  }
  // `git commit -a/--all`.
  if (
    findInvocation(command, { binary: 'git', subcommand: 'commit' }) &&
    invocationHasFlag(command, 'git', ['-a', '--all'])
  ) {
    return 'git commit -a'
  }
  // `git stash` (and `stash push`).
  if (findInvocation(command, { binary: 'git', subcommand: 'stash' })) {
    return 'git stash'
  }
  // `git reset --hard`.
  if (
    findInvocation(command, { binary: 'git', subcommand: 'reset' }) &&
    invocationHasFlag(command, 'git', ['--hard'])
  ) {
    return 'git reset --hard'
  }
  // `git checkout <branch>` / `git switch <branch>`.
  if (
    findInvocation(command, { binary: 'git', subcommand: 'checkout' }) ||
    findInvocation(command, { binary: 'git', subcommand: 'switch' })
  ) {
    return 'git checkout/switch'
  }
  // `git restore`.
  if (findInvocation(command, { binary: 'git', subcommand: 'restore' })) {
    return 'git restore'
  }
  return undefined
}

export const check = bashGuard((command, payload) => {
  // Record any `git add|mv|rm <path>` targets into the session ledger BEFORE
  // any return. The transcript lags within a turn, so without this a `git mv
  // old new` here followed by an Edit to `new` next would read `new` as foreign
  // (a parallel agent's file) and block the session's own rename. This is the
  // only PreToolUse hook that sees every Bash command, so it owns the recording.
  recordTouchedFromBash(payload.transcript_path, command)

  // Fleet-sync cascade sentinel: no parallel-session hazard in a fresh
  // cascade worktree off origin/main.
  if (/(?:^|\s)FLEET_SYNC\s*=\s*1\b/.test(command)) {
    return undefined
  }

  const gatedOp = detectGatedGitOp(command)
  if (!gatedOp) {
    return undefined
  }

  const repoDir = getProjectDir()
  const touched = readSessionTouchedPaths(payload.transcript_path)
  const foreign = listForeignDirtyPaths(repoDir, touched)
  if (foreign.length === 0) {
    // No parallel-agent signal — let the op through (overeager-staging-
    // guard still owns the general broad-add rule independently).
    return undefined
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASES, 3)
  ) {
    return undefined
  }

  return block(
    [
      `[parallel-agent-staging-guard] Blocked: ${gatedOp}`,
      '',
      `  ${foreign.length} dirty path(s) here are NOT from this session's edits`,
      '  and changed recently — most likely your OWN earlier work or an',
      '  aligned session. This operation would sweep up, hide, or destroy',
      '  those uncommitted changes:',
      ...foreign.slice(0, 10).map(p => `    ${p}`),
      ...(foreign.length > 10
        ? [`    ... and ${foreign.length - 10} more`]
        : []),
      '',
      "  Do this instead — land, don't sweep:",
      '  • Stage only YOUR files by explicit path: git add path/to/your-file.ts',
      '  • Land what is ready — `node scripts/fleet/land-work.mts --commit` or',
      '    `git commit -o <file>` — instead of stash / reset --hard / checkout.',
      '  • Unsure whose it is? `node scripts/fleet/whose-work.mts`.',
      '',
      '  Bypass (you are certain): user types',
      '    "Allow parallel-agent-staging bypass" in chat, then retry.',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
