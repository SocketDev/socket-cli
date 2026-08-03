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
      .split('\n')
      .find(l => l.trim() && !l.trimStart().startsWith('#'))
      ?.trim() ?? ''
  )
}

/**
 * True when a commit subject is a content-free placeholder. An empty/whitespace
 * subject also counts. Strips a single trailing period and lowercases before
 * matching the denylist.
 */
export function isPlaceholderSubject(subject: string): boolean {
  const norm = subject.trim().replace(/\.$/, '').trim().toLowerCase()
  if (!norm) {
    return true
  }
  return PLACEHOLDER_SUBJECTS.has(norm)
}
