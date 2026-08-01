#!/usr/bin/env node
// Claude Code PreToolUse hook — primary-checkout-branch-guard.
//
// Blocks branch creation / switching in the PRIMARY checkout. Per CLAUDE.md
// "Parallel Claude sessions": multiple sessions may share one `.git/`, so
// `git checkout/switch <branch>`, `git checkout -b`, and `git switch -c` are
// forbidden in the primary checkout — they yank HEAD out from under any other
// session working in that same directory. Branch work goes in a `git worktree`.
//
// Detection, classification, effective-directory resolution, the sanctioned
// restore-to-default carve-out, and the unified bypass all live in the shared
// `_shared/branch-switch.mts` module — the SAME core its user-global sibling
// `no-primary-branch-switch` consumes, so the two can never drift.
//
// What it catches (a `git` command in the primary checkout):
//   - `git checkout -b <name>` / `git checkout -B <name>`  (create + switch)
//   - `git switch -c <name>` / `git switch -C <name>`      (create + switch)
//   - `git switch <name>`, switch existing
//   - `git checkout <branch>`, switch existing
//   - `git checkout -` / `git switch -`                    (previous branch —
//     the `-` shorthand still moves HEAD)
//
// What it ALLOWS, not branch ops:
//   - a file restore: `git checkout -- <file>` / `git checkout .`
//   - switching TO the default branch, which is the sanctioned restore state
//   - any of the above inside a LINKED worktree, the sanctioned place for
//     branch work, or inside a SUBMODULE, which is a separate repository
//   - `git checkout`/`switch` with no branch argument
//
// Bypass (unified with no-primary-branch-switch — both guards fire on a primary
// switch, so both honor the SAME phrases): `Allow primary-branch bypass` OR
// `Allow branch switch`, typed by the human in a genuine user turn.
//
// Fails OPEN on its own errors (exit 0 + stderr log).

import {
  branchSwitchBypassAllowed,
  primaryBranchOp,
} from '../_shared/branch-switch.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'

// Pre-flight literal read textually by the build-time dispatch scanner. Mirrors
// the canonical BRANCH_SWITCH_TRIGGERS in _shared/branch-switch.mts.
export const triggers: readonly string[] = ['checkout', 'switch']

export const check = bashGuard((command, payload) => {
  const op = primaryBranchOp(command, payload)
  if (!op) {
    // No branch op, a worktree/submodule/non-repo target, or the sanctioned
    // restore-to-default — nothing to block.
    return undefined
  }
  if (branchSwitchBypassAllowed(payload)) {
    return undefined
  }
  const verb = op.kind === 'create' ? 'Creating' : 'Switching'
  return block(
    [
      `[primary-checkout-branch-guard] Blocked: ${verb} a branch in the PRIMARY checkout.`,
      `  Where:  ${op.dir}`,
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
      `  message:  Allow primary-branch bypass   (or: Allow branch switch)`,
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['primary-branch', 'branch-switch'],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
