/**
 * @file Types for the auditing-history engine — fleet commit-thrash /
 *   accidental-revert detector. Every shape is exported (privacy by
 *   not-importing, per CLAUDE.md "Export everything"); no `any`.
 */

/**
 * One commit in the audit window.
 */
export interface WindowCommit {
  sha: string
  /**
   * Subject line (first line of the message).
   */
  subject: string
  authorName: string
  authorEmail: string
  /**
   * ISO-8601 commit time.
   */
  when: string
  /**
   * True when the subject starts with a `revert:` / `revert(scope):`
   * Conventional Commit type.
   */
  isRevertTagged: boolean
  /**
   * `git patch-id --stable` of the commit's diff; undefined when the diff is
   * empty/unparseable.
   */
  patchId: string | undefined
}

/**
 * How close in authorship two thrashing commits are — the "stepping on toes"
 * signal.
 */
export type Attribution = 'same-session' | 'cross-session' | 'cross-author'

/**
 * Signal 1 (highest confidence): a later commit whose diff is the inverse of an
 * earlier in-window commit's diff (same `git patch-id`), where the later commit
 * is NOT `revert:`-tagged.
 */
export interface RevertPair {
  kind: 'untagged-revert'
  /**
   * The earlier commit whose change was undone.
   */
  original: WindowCommit
  /**
   * The later commit that undid it without a `revert:` prefix.
   */
  undo: WindowCommit
  attribution: Attribution
}

/**
 * Signal 2 (medium confidence): a file line-region that flips `+ → − → +` (or
 * `− → + → −`) across ≥3 in-window commits — the same surface set, unset,
 * re-set.
 */
export interface OscillationRun {
  kind: 'oscillation'
  file: string
  /**
   * The commits, in order, that touched the oscillating region.
   */
  commits: WindowCommit[]
  attribution: Attribution
}

/**
 * Signal 3 (lowest confidence): a file touched by ≥`minTouches` in-window
 * commits whose net diff against the window start is empty or near-empty —
 * churn that nets ~zero.
 */
export interface NetZeroFile {
  kind: 'net-zero'
  file: string
  touchCount: number
  /**
   * Net added+removed line count after the window (0 = exact wash).
   */
  netLineDelta: number
  attribution: Attribution
}

export type Finding = NetZeroFile | OscillationRun | RevertPair

/**
 * The per-repo audit result.
 */
export interface RepoThrashReport {
  repo: string
  /**
   * Resolved default branch the window walked.
   */
  branch: string
  windowDays: number | undefined
  sinceTag: string | undefined
  commitCount: number
  findings: Finding[]
}

/**
 * The fleet-wide rollup across repos.
 */
export interface ThrashReport {
  repos: RepoThrashReport[]
  generatedAt: string
}
