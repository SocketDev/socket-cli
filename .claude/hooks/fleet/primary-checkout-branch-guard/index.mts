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
// Fails OPEN on its own errors (exit 0 + stderr log).

import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { actedOnPath } from '../_shared/fleet-context.mts'
import { resolveDefaultBranch } from '../_shared/git-branch.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'

// Pre-flight: the dispatcher imports + runs this guard only when the raw
// command contains one of these substrings. `check` can return a block only
// when `firstBranchOp` finds a `git checkout` / `git switch` segment whose args
// include the literal `checkout` or `switch` token — so every blocking command
// necessarily contains one of these. Complete set (no narrower trigger exists).
export const triggers: readonly string[] = ['checkout', 'switch']

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

// The ref a branch op moves HEAD to: the name after `-b/-B/-c/-C` for a create,
// else the pathspec-less positional target of a switch/checkout. Used to carve
// out switching TO the default branch (always safe — it's the sanctioned state).
export function branchTarget(args: readonly string[]): string | undefined {
  const sub = args.find(a => a === 'checkout' || a === 'switch')
  if (!sub) {
    return undefined
  }
  const rest = args.slice(args.indexOf(sub) + 1)
  for (const flag of ['-b', '-B', '-c', '-C']) {
    const i = rest.indexOf(flag)
    if (i >= 0 && i + 1 < rest.length) {
      return rest[i + 1]
    }
  }
  if (looksLikePathRestore(rest)) {
    return undefined
  }
  return rest.find(isSwitchTarget)
}

export function firstBranchOp(command: string):
  | {
      kind: 'create' | 'switch'
      dashC?: string | undefined
      target?: string | undefined
    }
  | undefined {
  for (const c of commandsFor(command, 'git')) {
    const kind = branchOpKind(c.args)
    if (kind) {
      const dashC = dashCDir(c.args)
      const target = branchTarget(c.args)
      return {
        kind,
        ...(dashC === undefined ? {} : { dashC }),
        ...(target === undefined ? {} : { target }),
      }
    }
  }
  return undefined
}

export const check = bashGuard((command, payload) => {
  const op = firstBranchOp(command)
  if (!op) {
    return undefined
  }
  // Effective dir: honor a subshell `cd` in the command (actedOnPath), THEN a
  // `-C <path>` on the git op relative to that. Previously only `-C` was
  // honored, so a `(cd <other-repo> && git switch x)` was judged against the
  // session cwd, not the repo the switch actually targets.
  const baseCwd = actedOnPath(payload)
  const cwd = op.dashC ? path.resolve(baseCwd, op.dashC) : baseCwd
  if (!isPrimaryCheckout(cwd)) {
    // Branch work in a linked worktree is exactly what the rule wants.
    return undefined
  }
  // Switching TO the default branch in the primary is always safe — it's the
  // sanctioned state, and primary-checkout-on-default-stop-guard REQUIRES it, so
  // the restore path must not be blocked (else the two guards deadlock).
  if (op.kind === 'switch' && op.target === resolveDefaultBranch(cwd)) {
    return undefined
  }
  const verb = op.kind === 'create' ? 'Creating' : 'Switching'
  return block(
    [
      `[primary-checkout-branch-guard] Blocked: ${verb} a branch in the PRIMARY checkout.`,
      `  Where:  ${cwd}`,
      `  Mantra: branch work goes in a git worktree — NEVER move HEAD in the primary.`,
      `  Why:    parallel Claude sessions share this .git/; switching HEAD here yanks`,
      `          the tree out from under sibling sessions and lands the next commit`,
      `          on the wrong branch.`,
      `  Fix: cut a worktree instead —`,
      `    git worktree add .claude/worktrees/<topic> -b <branch>   # new branch`,
      `    git worktree add .claude/worktrees/<topic> <branch>      # existing branch`,
      `  then work inside that dir (its branch is isolated from the primary).`,
      ``,
      `  To proceed here anyway, the user must type the EXACT phrase in a new`,
      `  message:  Allow primary-branch bypass`,
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['primary-branch'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
