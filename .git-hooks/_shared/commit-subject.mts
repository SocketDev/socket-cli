// Placeholder commit-subject detection, shared by both enforcement surfaces:
//   - the no-placeholder-commit-subject-guard PreToolUse hook (.claude/hooks/),
//     which inspects `git commit -m` tool calls, and
//   - the commit-msg git-stage backstop (.git-hooks/), which inspects the
//     subject regardless of how the commit was made (subprocess / worktree /
//     CI / test harness).
// Canonical home: .git-hooks/_shared/; the .claude/hooks/ guard imports this
// cross-tree (the shared thing is this code, per the fleet "DRY across the two
// hook trees" rule).

// Subjects that say nothing about the change — the fingerprint of a
// test-harness / replayed / sandbox commit (a batch of `initial` commits once
// reached a fleet repo's main). Matched case-insensitively against the whole
// trimmed subject, after stripping one trailing period.
const PLACEHOLDER_SUBJECTS = new Set([
  '.',
  'changes',
  'commit',
  'fix',
  'fixes',
  'fixup',
  'init',
  'initial',
  'initial commit',
  'temp',
  'test',
  'tmp',
  'update',
  'updates',
  'wip',
])

/**
 * The subject line of a commit message: the first non-blank, non-comment line.
 */
export function commitSubject(message: string): string {
  return (
    message
      .split(/\r?\n/)
      .find(l => l.trim() && !l.trimStart().startsWith('#'))
      ?.trim() ?? ''
  )
}

/**
 * Why a commit subject is unusable, or `ok`.
 *
 * `empty` and `placeholder` are separated because they have DIFFERENT causes
 * and different fixes. An empty subject is almost never someone typing nothing:
 * it is a `-F` path that did not resolve, a truncated command line, or an
 * editor closed without saving. Telling that author their subject looks like
 * `wip` sends them looking for a denylist entry that was never involved.
 */
export type CommitSubjectVerdict = 'empty' | 'ok' | 'placeholder'

/**
 * Classify a commit subject. Strips a single trailing period and lowercases
 * before matching the denylist.
 */
export function commitSubjectVerdict(subject: string): CommitSubjectVerdict {
  const norm = subject.trim().replace(/\.$/, '').trim().toLowerCase()
  if (!norm) {
    return 'empty'
  }
  return PLACEHOLDER_SUBJECTS.has(norm) ? 'placeholder' : 'ok'
}

/**
 * True when a commit subject is unusable, either kind. Callers that need to
 * explain WHICH problem it is read {@link commitSubjectVerdict} instead.
 */
export function isPlaceholderSubject(subject: string): boolean {
  return commitSubjectVerdict(subject) !== 'ok'
}
