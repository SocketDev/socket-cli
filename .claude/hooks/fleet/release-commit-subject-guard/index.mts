#!/usr/bin/env node
// Claude Code PreToolUse hook — release-commit-subject-guard.
//
// Blocks a `git commit` whose RELEASE subject carries anything past the
// version. A release subject is exactly `chore(release): X.Y.Z` — nothing
// else. Incident (socket-cli, 2026-08-01):
//
//   chore(release): 1.1.151 — 1.1.150 burned on the shim-wrapped stage 403
//
// Release history is a version ledger. Tooling greps it for the previous
// release, changelog generators key off it, and humans scan it for "which
// version was that". A rationale clause in the subject makes the ledger a
// narrative: the line no longer parses as a version marker, and the story it
// tells is about a FAILED attempt, which is not what the release is.
//
// Where that story belongs: the commit BODY, the changelog entry, or the PR.
// All three are read by someone looking for the why; the subject is read by
// someone looking for the version.
//
// PreToolUse at the tool layer, like the ai-attribution guard, so it also
// covers non-fleet repos with no fleet git hooks — the subject is written
// by an agent composing the command, and that is the moment to catch it.
//
// Bypass: `Allow release-subject bypass`.

import { isGitCommit } from '../_shared/commit-command.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'

// Dispatcher pre-flight: every `git commit` carries the literal `commit`
// substring, and a release subject carries `release`.
export const triggers: readonly string[] = ['release']

// require-regex-comment: a `chore(release):` subject, capturing everything
// after the version. `[^\n'"]*` stops at the message's closing quote or a
// newline so a multi-line -m body is never read as subject overflow.
const RELEASE_SUBJECT_RE =
  /chore\(release\):\s*v?\d+\.\d+\.\d+(?<tail>[^\n'"]*)/

/**
 * The offending tail of a release subject — the text after the version — or
 * undefined when the subject is a clean `chore(release): X.Y.Z`. A tail of
 * only punctuation/whitespace (a trailing period, say) is clean; anything
 * with a word in it is commentary. Pure; exported for tests.
 */
export function releaseSubjectTail(command: string): string | undefined {
  const m = RELEASE_SUBJECT_RE.exec(command)
  const tail = m?.groups?.['tail']?.trim()
  if (!tail) {
    return undefined
  }
  // A word character means prose. Bare punctuation is not commentary.
  return /[a-z0-9]/i.test(tail) ? tail : undefined
}

export const check = bashGuard(command => {
  if (!isGitCommit(command)) {
    return undefined
  }
  const tail = releaseSubjectTail(command)
  if (!tail) {
    return undefined
  }
  return block(
    [
      '🚨 release-commit-subject-guard: blocked a release commit whose',
      '   subject carries commentary past the version.',
      '',
      `Saw after the version: ${tail}`,
      '',
      'A release subject is exactly the type, the scope, and the version:',
      '  chore(release): 1.1.151',
      '',
      'Release history is a version ledger — tooling greps it for the',
      'previous release and humans scan it for a version. Rationale, a prior',
      "attempt's failure, incident notes: those go in the commit BODY, the",
      'changelog entry, or the PR, all of which are read by someone looking',
      'for the why. The subject is read by someone looking for the version.',
      '',
      'Fix: cut the subject back to `chore(release): X.Y.Z` and move the',
      'explanation into the body with a second -m.',
      '',
      'Bypass (the user must type verbatim in a recent turn):',
      '  `Allow release-subject bypass`',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['release-subject'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
