#!/usr/bin/env node
// Claude Code PreToolUse hook — primary-checkout-branch-guard.
//
// Blocks branch creation / switching in the PRIMARY checkout. Per CLAUDE.md
// "Parallel Claude sessions": multiple sessions may share one `.git/`, so
// `git checkout/switch <branch>`, `git checkout -b`, and `git switch -c` are
// forbidden in the primary checkout — they yank HEAD out from under any other
// session working in that same directory. Branch work goes in a `git worktree`.
//
// What it catches (a `git` command in the primary checkout):
//   - `git checkout -b <name>` / `git checkout -B <name>`  (create + switch)
//   - `git switch -c <name>` / `git switch -C <name>`      (create + switch)
//   - `git switch <name>`                                  (switch existing)
//   - `git checkout <branch>`                              (switch existing)
//   - `git checkout -` / `git switch -`                    (previous branch —
//     the `-` shorthand still moves HEAD)
//
// What it ALLOWS (not branch ops):
//   - `git checkout -- <file>` / `git checkout .` (file restore — has `--`
//     or a `.` arg)
//   - any of the above inside a LINKED worktree (the sanctioned place for
//     branch work)
//   - `git checkout`/`switch` with no branch argument
//
// Effective directory: `git -C <path> checkout <branch>` runs the checkout in
// <path>, so the guard resolves the `-C` target (against the session cwd) and
// tests THAT for primary-ness — a worktree cwd can't launder a switch aimed at
// the primary via `-C`.
//
// Why a guard, not just the doc rule: the CLAUDE.md clause listed the
// prohibition but shipped no enforcer, so an agent created a `fix/...` branch
// directly in the primary checkout while two sibling worktree sessions were
// live. The fix landed via cherry-pick; this guard stops the branch from being
// cut in the primary checkout at all.
//
// Bypass: "Allow primary-branch bypass" in a recent user turn.
//
// Fails OPEN on its own errors (exit 0 + stderr log).

import path from 'node:path'
import process from 'node:process'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

// Pre-flight: the dispatcher imports + runs this guard only when the raw
// command contains one of these substrings. `check` can return a block only
// when `firstBranchOp` finds a `git checkout` / `git switch` segment whose args
// include the literal `checkout` or `switch` token — so every blocking command
// necessarily contains one of these. Complete set (no narrower trigger exists).
export const triggers: readonly string[] = ['checkout', 'switch']

const BYPASS_PHRASES = [
  'Allow primary-branch bypass',
  'Allow primary branch bypass',
] as const

// A `git checkout` arg list that's a working-tree / file restore rather than a
// branch switch: `git checkout -- <file>` or `git checkout .`. Conservative —
// anything ambiguous is treated as a branch (the guard is about NOT moving
// HEAD in the primary checkout).
function looksLikePathRestore(args: readonly string[]): boolean {
  return args.includes('--') || args.includes('.')
}

// A ref that moves HEAD: a normal branch/commit name (no leading dash), or the
// `-` shorthand for the previous branch (`git checkout -` / `git switch -`).
// Without the `-` case, the previous-branch switch slips past the flag filter.
function isSwitchTarget(arg: string): boolean {
  return arg === '-' || !arg.startsWith('-')
}

/**
 * Inspect a single `git` command's args; return the branch operation it
 * performs, or undefined if it's not a branch create/switch.
 */
export function branchOpKind(
  args: readonly string[],
): 'create' | 'switch' | undefined {
  const sub = args.find(a => a === 'checkout' || a === 'switch')
  if (!sub) {
    return undefined
  }
  const rest = args.slice(args.indexOf(sub) + 1)
  // Create-and-switch flags on either subcommand.
  if (
    rest.includes('-b') ||
    rest.includes('-B') ||
    rest.includes('-c') ||
    rest.includes('-C')
  ) {
    return 'create'
  }
  if (sub === 'switch') {
    // `git switch <name>` (or `git switch -`) — moving to another branch. A
    // bare `git switch` with only flags has no target → ignore.
    const target = rest.find(isSwitchTarget)
    return target ? 'switch' : undefined
  }
  // sub === 'checkout': a branch switch only when there's a target arg that
  // isn't a file-restore form. `--`/`.` guards the file-restore case, so a lone
  // `-` here is the previous-branch shorthand, not a filename.
  if (looksLikePathRestore(rest)) {
    return undefined
  }
  const target = rest.find(isSwitchTarget)
  return target ? 'switch' : undefined
}

/**
 * True when `cwd` is the PRIMARY checkout (not a linked worktree). In a linked
 * worktree `git rev-parse --git-dir` resolves under `.git/worktrees/<name>`; in
 * the primary it's the repo's own `.git`.
 */
export function isPrimaryCheckout(cwd: string): boolean {
  const r = spawnSync('git', ['rev-parse', '--git-dir'], {
    cwd,
    timeout: spawnTimeoutMs(5000),
  })
  if (r.status !== 0) {
    // Not a git repo (or git unavailable) — nothing to guard, fail open.
    return false
  }
  const gitDir = normalizePath(String(r.stdout).trim())
  return !gitDir.includes('/.git/worktrees/')
}

// `git -C <path> ...` runs the subcommand in <path>. Extract that path so a
// branch op aimed at the primary via `-C` is judged by the target, not the
// (possibly worktree) session cwd.
function dashCDir(args: readonly string[]): string | undefined {
  const i = args.indexOf('-C')
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

export function firstBranchOp(
  command: string,
): { kind: 'create' | 'switch'; dashC?: string } | undefined {
  for (const c of commandsFor(command, 'git')) {
    const kind = branchOpKind(c.args)
    if (kind) {
      const dashC = dashCDir(c.args)
      return dashC === undefined ? { kind } : { kind, dashC }
    }
  }
  return undefined
}

export const check = bashGuard((command, payload) => {
  const op = firstBranchOp(command)
  if (!op) {
    return undefined
  }
  const baseCwd = payload.cwd ?? process.cwd()
  // A `-C <path>` on the branch-op command redirects it to <path>; judge THAT
  // directory (resolved against the session cwd), else the session cwd.
  const cwd = op.dashC ? path.resolve(baseCwd, op.dashC) : baseCwd
  if (!isPrimaryCheckout(cwd)) {
    // Branch work in a linked worktree is exactly what the rule wants.
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASES)) {
    return undefined
  }
  const verb = op.kind === 'create' ? 'Creating' : 'Switching'
  return block(
    `\n[primary-checkout-branch-guard] Blocked: ${verb} a branch in the ` +
      `PRIMARY checkout.\n` +
      `  Mantra: branch work goes in a git worktree.\n` +
      `  Multiple sessions may share this \`.git/\`; moving HEAD here yanks ` +
      `it out from under any sibling session.\n` +
      `  Fix: cut a worktree instead —\n` +
      `    git worktree add ../<repo>-<topic> -b <branch>\n` +
      `    cd ../<repo>-<topic>\n` +
      `  Bypass: type "Allow primary-branch bypass" in a recent message.\n`,
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
