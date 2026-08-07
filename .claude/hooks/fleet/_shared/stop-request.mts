/*
 * @file What a STOP request is, and what it asks for. One definition, because
 *   two hooks read it for opposite reasons: `dont-stop-mid-queue-nudge` skips
 *   when the user authorized stopping, and `stop-means-commit-guard` arms on the
 *   same signal. Two copies of this regex would drift into disagreeing about
 *   whether a turn was allowed to end.
 *
 *   STOP means stop FORWARD ACTION — start no new work. It does not mean freeze
 *   wherever the turn happens to be:
 *
 *   - Mid-commit, with the change staged or the gate running: FINISH the commit.
 *     A pre-commit gate that is still running is the case that most looks like a
 *     stopping point and least is one.
 *   - Literally executing commit commands: do not interrupt them. Killing a
 *     `git commit` mid-flight is how an index.lock outlives the turn.
 *   - Work uncommitted and nothing in flight: land it, then report.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * A user turn authorizing the turn to end. Matched anywhere in the text, since
 * a grant reads the same mid-sentence ("okay, let's pause here") as it does
 * alone.
 *
 * Deliberately broader than {@link isStopRequest}: a hook that SKIPS on this
 * signal should err toward believing the user, while a hook that BLOCKS on it
 * should ask the narrower question below.
 */
export const STOP_AUTHORIZATION_RE =
  /\b(?:enough\s+for\s+(?:now|today)|halt|hold|let'?s\s+pause|let'?s\s+stop|pause|stop|that'?s\s+enough|wait|we'?re\s+done)\b/i

/**
 * How a user asks for the turn to end, anchored at the START of the message. A
 * stop word buried mid-sentence is usually describing something ("the scanner
 * stops at the first match"), not asking for one.
 */
const STOP_REQUEST_RE =
  /^\s*(?:ok(?:ay)?[,\s]+)?(?:please\s+)?(?:halt|hold\s+(?:off|on)|pause|stop|wrap\s+(?:it\s+)?up)\b/i

/**
 * Words that invert the request. "Don't stop until the tests pass" and "stop
 * once CI is green" tell the turn to KEEP GOING, and reading either as a pause
 * would block a turn that was told to continue.
 */
const NOT_A_PAUSE_RE = /\b(?:do\s?n[o']?t|never|once|unless|until)\b/i

/**
 * Whether `text` is a user asking to stop or pause, as opposed to mentioning
 * stopping or forbidding it.
 *
 * Pure and exported: the judgment is a question about a string, so that is how
 * it is tested.
 */
export function isStopRequest(text: string | undefined): boolean {
  if (!text) {
    return false
  }
  const firstLine = text.replace(/\r\n/g, '\n').split('\n')[0] ?? ''
  return STOP_REQUEST_RE.test(firstLine) && !NOT_A_PAUSE_RE.test(firstLine)
}

/**
 * Whether `text` anywhere authorizes the turn to end.
 *
 * The permissive twin of {@link isStopRequest}, for a hook that stands down on
 * the signal rather than acting on it.
 */
export function authorizesStop(text: string | undefined): boolean {
  return Boolean(text) && STOP_AUTHORIZATION_RE.test(text!)
}

/**
 * Whether a commit is mid-flight in `gitRoot`.
 *
 * `index.lock` exists for the duration of a `git commit`, so its presence means
 * another process is writing the index right now — a pre-commit gate running
 * its lint and tests, most often. A guard must not block a turn-end on
 * uncommitted work in that window: the commit is already happening, and the
 * only thing an interruption buys is a stale lock the next turn has to clear.
 */
export function commitInFlight(gitRoot: string): boolean {
  return (
    existsSync(path.join(gitRoot, '.git', 'index.lock')) ||
    existsSync(path.join(gitRoot, '.git', 'COMMIT_EDITMSG.lock')) ||
    // A merge/rebase/cherry-pick sequence mid-run owns the tree too.
    existsSync(path.join(gitRoot, '.git', 'MERGE_HEAD')) ||
    existsSync(path.join(gitRoot, '.git', 'CHERRY_PICK_HEAD')) ||
    existsSync(path.join(gitRoot, '.git', 'rebase-merge')) ||
    existsSync(path.join(gitRoot, '.git', 'rebase-apply'))
  )
}
