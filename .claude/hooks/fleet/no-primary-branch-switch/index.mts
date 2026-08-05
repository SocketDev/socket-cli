#!/usr/bin/env node
// Claude Code PreToolUse hook — no-primary-branch-switch.
//
// The USER-GLOBAL sibling of primary-checkout-branch-guard: same rule, wired
// through the wheelhouse dispatcher so it fires from EVERY repo session (any
// `~/projects/<repo>` primary checkout), not only fleet-managed ones the
// per-repo dispatcher covers. It supersedes a hand-placed standalone hook that
// lived outside the managed fleet.
//
// Blocks a git command that would CHANGE THE BRANCH of a PRIMARY working tree.
// Branch-specific work — committing, rebasing, squashing, opening PRs — belongs
// in a `git worktree`, leaving the primary checkout on whatever branch it is
// already on; switching its branch out from under a parallel session destroys
// unsaved work and lands the next commit on the wrong branch.
//
// Detection, primary-vs-worktree/submodule classification, effective-directory
// resolution (leading `cd` + `-C`), the sanctioned restore-to-default carve-out,
// and the unified bypass all live in `_shared/branch-switch.mts` — the SAME
// core primary-checkout-branch-guard consumes, so this thin wrapper and that
// guard can never drift. This module adds only the user-global framing + its
// own block message.
//
// Bypass is unified: both guards fire on a primary switch, so both honor the
// SAME phrases. `Allow branch switch` is the canonical shared phrase, and
// `Allow primary-branch bypass` also clears them. Either must be typed by the
// human in a genuine user turn.
//
// Fails OPEN on any parse / git error.

import {
  branchSwitchBypassAllowed,
  primaryBranchOp,
} from '../_shared/branch-switch.mts'
import type { PrimaryBranchOp } from '../_shared/branch-switch.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'

// Pre-flight literal read textually by the build-time dispatch scanner. Mirrors
// the canonical BRANCH_SWITCH_TRIGGERS in _shared/branch-switch.mts.
export const triggers: readonly string[] = ['checkout', 'switch']

export const BYPASS_PHRASE = 'Allow branch switch'

export function blockMessage(op: PrimaryBranchOp): string {
  const verb = op.kind === 'create' ? 'Creating' : 'Switching'
  return [
    `[no-primary-branch-switch] Blocked: ${verb} a branch in the PRIMARY checkout —`,
    'the move that clobbers another session working in it. Do branch work in a',
    'worktree instead, so the primary stays on whatever branch it is already on:',
    `  Where: ${op.dir}`,
    '',
    '  git -C <repo> worktree add /tmp/wt-<name> <branch>   # or -b <newbranch>',
    '  # ...work in /tmp/wt-<name>..., then: git -C <repo> worktree remove /tmp/wt-<name>',
    '',
    'If you genuinely must switch the primary checkout, the user must type an',
    `EXACT phrase in a new message:  ${BYPASS_PHRASE}   (or: Allow primary-branch bypass)`,
  ].join('\n')
}

export const check = bashGuard((command, payload): GuardResult => {
  const op = primaryBranchOp(command, payload)
  if (!op) {
    // No branch op, a worktree/submodule/non-repo target, or the sanctioned
    // restore-to-default — nothing to block.
    return undefined
  }
  if (branchSwitchBypassAllowed(payload)) {
    return undefined
  }
  return block(blockMessage(op))
})

export const hook = defineHook({
  bypass: ['branch-switch'],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  global: true,
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
