#!/usr/bin/env node
// Claude Code Stop hook — git-identity-drift-nudge.
//
// Fires at turn-end. Reads the EFFECTIVE git `user.email` for the project
// dir, local over global, the value git would stamp on a commit, and, if
// it's a non-verifiable placeholder (`*@example.com`, `agent-ci@…`, an
// RFC-2606 reserved domain), prints a stderr reminder to fix it before a
// push.
//
// Why: a commit authored with a placeholder email fails GitHub's
// `required_signatures` even when the GPG/SSH signature is valid, because
// the author email isn't tied to the signing key's GitHub account. The bad
// value is usually planted OUTSIDE the tool channel (an agent-CI container
// entrypoint writes it to the local `.git/config`), so the PreToolUse
// git-config-write-guard never sees the write. `git-config-write-guard`'s
// SessionStart probe auto-unsets it, but only at session start — if it gets
// set MID-session (a sub-shell, a fresh `cd` into a poisoned checkout), the
// push is the first time you'd find out, after work is committed. This
// reminder catches it at the Stop boundary, before the push round-trip.
//
// Reminder, not guard: it never blocks the stop (a placeholder identity is
// a fixable config issue, not a reason to wedge the turn). The companion
// `git-config-write-guard` is the blocking surface for git-config WRITES;
// this reminder covers the already-set-EFFECTIVE-identity case at a
// different boundary (Stop, not PreToolUse) — distinct concern, distinct
// hook.
//
// Fail-open: any error returns undefined (a reminder bug must not wedge
// every Stop).

import {
  defaultRepoDir,
  effectiveUserEmail,
  hasGlobalIdentity,
  isPlaceholderEmail,
} from '../_shared/git-identity.mts'
import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

export function formatReminder(
  email: string,
  { globalFallbackExists }: { globalFallbackExists: boolean },
): string {
  const fix = globalFallbackExists
    ? 'git config --local --unset user.email && git config --local --unset user.name'
    : 'git config --global user.email "<you>@<domain>" && git config --global user.name "<Your Name>"'
  return `💡 git-identity-drift-nudge: placeholder git author "${email}" fails GitHub required_signatures — ${fix}, then \`git commit --amend --reset-author --no-edit\` before pushing`
}

// The pure decision: should the reminder fire, given the resolved email?
// Side-effect-free so it unit-tests without spawning git.
export function shouldRemind(email: string): boolean {
  return isPlaceholderEmail(email)
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const repoDir = defaultRepoDir(payload?.cwd)
  const email = effectiveUserEmail(repoDir)
  if (!email || !shouldRemind(email)) {
    return undefined
  }
  return notify(
    formatReminder(email, { globalFallbackExists: hasGlobalIdentity() }),
  )
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
