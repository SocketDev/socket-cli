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
// Why this exists (incident 2026-05-27, socket-lib): see
// parallel-agent-on-stop-reminder. The Stop reminder surfaces the
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
// Fails open on hook bugs (exit 0 + stderr log). Reads a PreToolUse JSON
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
import {
  detectBroadGitAdd,
  findInvocation,
  invocationHasFlag,
} from '../_shared/shell-command.mts'
import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface ToolPayload {
  readonly tool_name?: string | undefined
  readonly tool_input?: { readonly command?: unknown | undefined } | undefined
  readonly transcript_path?: string | undefined
}

const BYPASS_PHRASES = ['Allow parallel-agent-staging bypass'] as const

function getProjectDir(): string {
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

async function main(): Promise<void> {
  const raw = await readStdin()
  let payload: ToolPayload
  try {
    payload = JSON.parse(raw) as ToolPayload
  } catch {
    process.exit(0)
  }
  if (payload.tool_name !== 'Bash') {
    process.exit(0)
  }
  const command = (payload.tool_input as { command?: unknown } | undefined)
    ?.command
  if (typeof command !== 'string' || !command.trim()) {
    process.exit(0)
  }

  // Record any `git add|mv|rm <path>` targets into the session ledger BEFORE
  // any exit. The transcript lags within a turn, so without this a `git mv old
  // new` here followed by an Edit to `new` next would read `new` as foreign
  // (a parallel agent's file) and block the session's own rename. This is the
  // only PreToolUse hook that sees every Bash command, so it owns the recording.
  recordTouchedFromBash(payload.transcript_path, command)

  // Fleet-sync cascade sentinel: no parallel-session hazard in a fresh
  // cascade worktree off origin/main.
  if (/(?:^|\s)FLEET_SYNC\s*=\s*1\b/.test(command)) {
    process.exit(0)
  }

  const gatedOp = detectGatedGitOp(command)
  if (!gatedOp) {
    process.exit(0)
  }

  const repoDir = getProjectDir()
  const touched = readSessionTouchedPaths(payload.transcript_path)
  const foreign = listForeignDirtyPaths(repoDir, touched)
  if (foreign.length === 0) {
    // No parallel-agent signal — let the op through (overeager-staging-
    // guard still owns the general broad-add rule independently).
    process.exit(0)
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASES, 3)
  ) {
    process.exit(0)
  }

  process.stderr.write(
    [
      `[parallel-agent-staging-guard] Blocked: ${gatedOp}`,
      '',
      `  ${foreign.length} dirty path(s) here were NOT authored by this`,
      '  session and changed recently — likely another agent on the',
      '  same checkout. This operation would sweep up, hide, or destroy',
      '  their in-flight work:',
      ...foreign.slice(0, 10).map(p => `    ${p}`),
      ...(foreign.length > 10
        ? [`    ... and ${foreign.length - 10} more`]
        : []),
      '',
      '  Fix: stage only YOUR files by explicit path, and avoid stash /',
      '  reset --hard / checkout while the other agent is active.',
      '    git add path/to/your-file.ts',
      '',
      '  Bypass (only if you are certain): user types',
      '    "Allow parallel-agent-staging bypass" in chat, then retry.',
    ].join('\n') + '\n',
  )
  process.exit(2)
}

main().catch(e => {
  process.stderr.write(
    `[parallel-agent-staging-guard] hook bug — fail-open. ${e instanceof Error ? e.message : String(e)}\n`,
  )
  process.exit(0)
})
