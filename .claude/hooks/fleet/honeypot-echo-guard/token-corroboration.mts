/*
 * @file The evidence tests that tell a real citation from honeypot bait, for
 *   `honeypot-echo-guard`.
 *
 *   A twelve-hex-character run is ambiguous on its own: it is the shape of an
 *   abbreviated commit SHA, a digest prefix, and a hex-stamped filename, and
 *   fleet prose doctrine requires citing SHAs as receipts. Two independent
 *   reads resolve that ambiguity. `git rev-parse` says whether the token names
 *   a commit this checkout actually has, and the session transcript says
 *   whether the agent read the token off untrusted content this turn.
 */

import { gitOut } from '../_shared/git-branch.mts'
import { readLines } from '../_shared/transcript.mts'

/**
 * True when `git rev-parse` can answer questions about `repoDir` at all. When
 * it cannot (no git, no repo), token resolution is impossible and the token
 * check stands down rather than blocking every twelve-hex string.
 */
export function gitCanResolveObjects(repoDir: string): boolean {
  return gitOut(repoDir, ['rev-parse', '--git-dir']) !== undefined
}

/**
 * True when `token` names a real commit in `repoDir` — the test that separates
 * a legitimate abbreviated-SHA citation from a bait token.
 */
export function isKnownGitCommit(repoDir: string, token: string): boolean {
  return (
    gitOut(repoDir, [
      'rev-parse',
      '--verify',
      '--quiet',
      `${token}^{commit}`,
    ]) !== undefined
  )
}

/**
 * True when `token` shows up anywhere in the transcript at `transcriptPath` —
 * the corroboration that separates a real honeypot echo (the token was read
 * from a thread this session, then is about to be posted back) from an
 * ordinary SHA-shaped citation this checkout simply cannot resolve (a
 * cross-repo commit, a digest prefix, a hex-stamped filename). A honeypot
 * token can only reach the agent by reading it out of untrusted content, so
 * that reading leaves a trace in the transcript's tool results.
 *
 * A missing transcript path or an unreadable/empty transcript is treated as
 * SEEN (the conservative, block-preserving default) — this guard has no
 * positive evidence the token is innocent, so it keeps the prior blocking
 * behavior rather than newly trusting an unresolvable token.
 */
export function tokenSeenInTranscript(
  transcriptPath: string | undefined,
  token: string,
): boolean {
  const lines = readLines(transcriptPath)
  if (transcriptPath === undefined || lines.length === 0) {
    return true
  }
  const needle = token.toLowerCase()
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (lines[i]!.toLowerCase().includes(needle)) {
      return true
    }
  }
  return false
}
