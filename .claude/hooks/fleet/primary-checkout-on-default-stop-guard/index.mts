#!/usr/bin/env node
// Claude Code Stop hook — primary-checkout-on-default-stop-guard.
//
// Fires at turn-end. Asserts the PRIMARY checkout is on its default branch
// (main/master/origin HEAD). If a feature branch is checked out in the primary,
// the turn is BLOCKED until it's restored.
//
// Why a Stop lock in ADDITION to primary-checkout-branch-guard: that guard is a
// PreToolUse Bash hook — it blocks a `git checkout`/`git switch` typed as a Bash
// command, but it CANNOT see a checkout run INSIDE a script (a `.mts` the agent
// invokes with `node`, a Makefile target, a tool that shells git internally).
// A switch from any of those slips past PreToolUse and leaves the primary on a
// feature branch — where parallel sessions sharing the checkout land the next
// commit on the wrong branch. This lock catches the RESULT at turn-end, whatever
// the source: it reads the actual on-disk branch and blocks if it drifted.
//
// Scope:
//   - PRIMARY checkout only. A linked worktree's `.git` is a FILE (gitdir
//     pointer); the primary's is a DIRECTORY. Worktrees are the sanctioned home
//     for feature branches, so a worktree session never trips this.
//   - Fleet repos only (isFleetTarget) — a non-fleet solo repo has no
//     shared-checkout hazard.
//
// Fix: `git switch <default>` (primary-checkout-branch-guard allows switching
// TO the default branch — restoring is always safe). Move feature work into a
// worktree.
//
// Bypass: the user types `Allow off-default bypass` in a recent turn.
//
// Fails OPEN on its own errors (exit 0 + stderr log).

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isFleetTarget } from '../_shared/fleet-context.mts'
import { currentBranch, resolveDefaultBranch } from '../_shared/git-branch.mts'
import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow off-default bypass'

/**
 * True when `cwd` is the PRIMARY checkout (not a linked worktree). A linked
 * worktree's `git rev-parse --git-dir` resolves under `.git/worktrees/<name>`;
 * the primary's is the repo's own `.git`. Fails closed (false → skip) when git
 * is unavailable, so a non-git dir never blocks a stop.
 */
export function isPrimaryCheckout(cwd: string): boolean {
  const r = spawnSync('git', ['rev-parse', '--git-dir'], {
    cwd,
    timeout: spawnTimeoutMs(5000),
  }) as
    | { status?: number | null | undefined; stdout?: string | undefined }
    | undefined
  if (!r || r.status !== 0) {
    return false
  }
  return !normalizePath(String(r.stdout).trim()).includes('/.git/worktrees/')
}

export interface BranchState {
  readonly branch: string | undefined
  readonly defaultBranch: string
}

/**
 * The pure verdict: block when the primary is on a non-default branch. A
 * missing branch (detached HEAD / unresolved) is left alone — this lock is
 * about a lingering FEATURE branch, not detached states other tools own.
 */
export function isOffDefault(state: BranchState): boolean {
  return state.branch !== undefined && state.branch !== state.defaultBranch
}

export function blockMessage(cwd: string, state: BranchState): string {
  return [
    '[primary-checkout-on-default-stop-guard] Blocked: the PRIMARY checkout is off its default branch.',
    `  Where:   ${cwd}`,
    `  Branch:  ${state.branch}  (default is ${state.defaultBranch})`,
    '  Why:     the primary checkout must stay on the default branch — parallel',
    '           sessions share it, so a lingering feature branch here lands their',
    '           commits on the wrong branch. Feature work belongs in a worktree.',
    '  Fix: restore the primary —',
    `    git switch ${state.defaultBranch}`,
    '  (switching TO the default branch in the primary is allowed), then move any',
    '  feature work into a worktree:',
    '    git worktree add .claude/worktrees/<topic> -b <branch>',
    '',
    '  To end the turn with the primary off-default anyway, the user must type the',
    `  EXACT phrase in a new message:  ${BYPASS_PHRASE}`,
  ].join('\n')
}

export const check = (payload: ToolCallPayload): GuardResult => {
  if (!isFleetTarget(payload)) {
    return undefined
  }
  const cwd = resolveProjectDir(payload.cwd)
  if (!isPrimaryCheckout(cwd)) {
    // A worktree is the sanctioned home for feature branches — never block it.
    return undefined
  }
  const state: BranchState = {
    branch: currentBranch(cwd),
    defaultBranch: resolveDefaultBranch(cwd),
  }
  if (!isOffDefault(state)) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }
  return block(blockMessage(cwd, state))
}

export const hook = defineHook({
  bypass: ['off-default'],
  bypassMode: 'manual',
  check,
  event: 'Stop',
  type: 'guard',
})
void runHook(hook, import.meta.url)
