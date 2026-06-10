#!/usr/bin/env node
// Claude Code Stop hook — git-identity-drift-reminder.
//
// Fires at turn-end. Reads the EFFECTIVE git `user.email` for the project
// dir (local over global, the value git would stamp on a commit) and, if
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
// Fail-open: any error exits 0 (a reminder bug must not wedge every Stop).

import process from 'node:process'

import {
  defaultRepoDir,
  effectiveUserEmail,
  hasGlobalIdentity,
  isPlaceholderEmail,
} from '../_shared/git-identity.mts'

interface StopPayload {
  readonly cwd?: string | undefined
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
    // .unref() so the fallback timer can't keep the loop alive past the work;
    // a Stop hook must exit deterministically (a live handle hangs the
    // node --test runner).
    setTimeout(() => resolve(chunks), 200).unref()
  })
}

export function formatReminder(
  email: string,
  globalFallbackExists: boolean,
): string {
  const lines: string[] = []
  lines.push('')
  lines.push('ℹ git-identity-drift-reminder')
  lines.push('')
  lines.push(
    `Your effective git author email is a placeholder: \`${email}\`.`,
  )
  lines.push(
    'GitHub rejects a signed push from it (`required_signatures`): the',
  )
  lines.push("signature can't verify against a key tied to that address.")
  lines.push('')
  if (globalFallbackExists) {
    lines.push('Fix: drop the local override so your signed global identity wins:')
    lines.push('  git config --local --unset user.email')
    lines.push('  git config --local --unset user.name')
  } else {
    lines.push('Fix: set your real identity globally (not in the repo):')
    lines.push('  git config --global user.email "<you>@<domain>"')
    lines.push('  git config --global user.name "<Your Name>"')
  }
  lines.push('')
  lines.push(
    'Then re-author any commits already made this turn (e.g.',
  )
  lines.push('`git commit --amend --reset-author --no-edit`) before pushing.')
  lines.push('')
  return lines.join('\n')
}

// The pure decision: should the reminder fire, given the resolved email?
// Side-effect-free so it unit-tests without spawning git.
export function shouldRemind(email: string): boolean {
  return isPlaceholderEmail(email)
}

async function main(): Promise<void> {
  const raw = await readStdinRaw()
  let payload: StopPayload = {}
  try {
    payload = JSON.parse(raw) as StopPayload
  } catch {
    // No / malformed payload — resolve repo dir from env / cwd below.
  }

  const repoDir = defaultRepoDir(payload.cwd)
  const email = effectiveUserEmail(repoDir)
  if (!email || !shouldRemind(email)) {
    return
  }
  process.stderr.write(formatReminder(email, hasGlobalIdentity()))
}

// Run, then exit DETERMINISTICALLY (no lingering stdin listeners / timers).
main()
  .then(() => process.exit(0))
  .catch(e => {
    process.stderr.write(
      `[git-identity-drift-reminder] hook bug — fail-open. ${e instanceof Error ? e.message : String(e)}\n`,
    )
    process.exit(0)
  })
