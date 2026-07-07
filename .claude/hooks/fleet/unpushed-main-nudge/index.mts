#!/usr/bin/env node
// Claude Code Stop hook — unpushed-main-nudge.
//
// Fires at turn-end on the default branch (main / master). When local HEAD is
// AHEAD of its origin counterpart, it nags to push. When origin is AHEAD of
// local AND every origin-ahead commit is your own or a bot's (a squash or
// consolidation), it nudges to reconcile FORWARD (amend / lease-force-push),
// never rewind local to origin — local main is canonical. A real other user's
// origin-ahead commits are genuine divergence, so it stays silent there.
//
// Why: a commit fast-forwarded to local `main` but left unpushed is
// fragile. A parallel Claude session running `git reset --hard
// origin/main` (cascade / repair flows do this) discards every local-only
// commit ahead of origin — the work silently vanishes. "Landing" a commit
// means it reached ORIGIN, not just local main. This reminder makes the
// at-risk gap visible at the turn that created it, so the push happens
// before the next reset.
//
// Only fires on the default branch: an unpushed feature branch is normal
// (you push it when ready); an unpushed DEFAULT branch ahead of origin is
// the reset-wipe hazard.
//
// Exit codes: 0 — always (informational Stop hook). Fails open.

import process from 'node:process'

import {
  currentBranch,
  gitOut,
  isDefaultBranch,
} from '../_shared/git-branch.mts'
import { defineHook, notify, runHook } from '../_shared/guard.mts'

export function getProjectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

// Count of local commits ahead of origin/<branch>, or 0 when no upstream.
export function commitsAhead(repoDir: string, branch: string): number {
  const out = gitOut(repoDir, ['rev-list', '--count', `origin/${branch}..HEAD`])
  if (out === undefined) {
    return 0
  }
  const n = Number.parseInt(out, 10)
  /* c8 ignore next -- the count is always an integer on success; the NaN arm is a defensive fallback unreachable in practice */
  return Number.isFinite(n) ? n : 0
}

// Count of origin/<branch> commits NOT in local HEAD (origin ahead of local).
export function commitsBehind(repoDir: string, branch: string): number {
  const out = gitOut(repoDir, ['rev-list', '--count', `HEAD..origin/${branch}`])
  if (out === undefined) {
    return 0
  }
  const n = Number.parseInt(out, 10)
  /* c8 ignore next -- the count is always an integer on success */
  return Number.isFinite(n) ? n : 0
}

// A bot author email (cascade/CI/dependabot). The fleet's own cascade +
// auto-lander commit as the USER, so those are "own", not "bot"; this catches
// the DISTINCT bot identities that also legitimately land on origin. Plain
// substring tests (no regex) so the fleet command-regex guard stays quiet.
export function isBotEmail(email: string): boolean {
  const e = email.toLowerCase()
  return (
    e.includes('[bot]') ||
    e.includes('github-actions') ||
    e.includes('dependabot') ||
    e.includes('noreply.github')
  )
}

// Author emails of the origin-ahead commits (HEAD..origin/<branch>), newest
// first. Empty when none / git fails.
export function originAheadEmails(repoDir: string, branch: string): string[] {
  const out = gitOut(repoDir, ['log', `HEAD..origin/${branch}`, '--format=%ae'])
  if (!out) {
    return []
  }
  return out.split('\n').filter(line => line.trim())
}

// True when EVERY origin-ahead commit is the current identity or a bot — i.e. a
// squash/consolidation of your own (or a bot's) work, not a real other user's
// landing. Pure.
export function allOwnOrBot(options: {
  emails: readonly string[]
  myEmail: string | undefined
}): boolean {
  const opts = { __proto__: null, ...options } as typeof options
  const { emails, myEmail } = opts
  return emails.every(e => (myEmail && e === myEmail) || isBotEmail(e))
}

export async function check() {
  const repoDir = getProjectDir()
  const branch = currentBranch(repoDir)
  if (!branch || !isDefaultBranch(repoDir, branch)) {
    return undefined
  }
  const behind = commitsBehind(repoDir, branch)
  // origin/<branch> ahead of local is NORMALLY a squash/consolidation of your
  // own or a bot's commits, NOT a reason to rewind local. Nudge to reconcile
  // FORWARD only when the ahead-commits are all own/bot; a real other user's
  // commits are genuine divergence — stay silent (coordinating that is not this
  // hook's job, and warning would misread it as the squash case).
  if (behind > 0) {
    const myEmail = gitOut(repoDir, ['config', 'user.email']) || undefined
    const emails = originAheadEmails(repoDir, branch)
    if (emails.length && allOwnOrBot({ emails, myEmail })) {
      const ahead = commitsAhead(repoDir, branch)
      return notify(
        [
          `[unpushed-main-nudge] origin/${branch} is ${behind} commit(s) ahead of local ${branch} — but they are YOUR/bot work (a squash or cascade), not a rival's.`,
          '',
          `Flow is local ${branch} → push → origin; local ${branch} is CANONICAL.`,
          'Do NOT reset / revert / rewind / drop local to origin (it discards local work).',
          'Reconcile FORWARD — compare the commit timestamps, then:',
          ahead > 0
            ? `    git push --force-with-lease origin ${branch}   (local is ${ahead} ahead too)`
            : `    amend if origin is a 1-commit squash of your set, else: git push --force-with-lease origin ${branch}`,
          'Keep any reset additive/recoverable (backup tag or reflog, never git stash).',
          '',
        ].join('\n'),
      )
    }
    return undefined
  }
  const ahead = commitsAhead(repoDir, branch)
  if (ahead < 1) {
    return undefined
  }
  return notify(
    [
      `[unpushed-main-nudge] ${branch} is ${ahead} commit(s) ahead of origin/${branch} — UNPUSHED.`,
      '',
      'A local fast-forward is NOT landed. A parallel session that resets',
      `${branch} to origin/${branch} (cascade / repair flows do this) will wipe`,
      'these commits. Push now so the work survives:',
      `    git push origin ${branch}`,
      '',
    ].join('\n'),
  )
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
