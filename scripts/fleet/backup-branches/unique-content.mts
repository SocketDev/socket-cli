/*
 * @file The safety gate: does a backup branch hold content the default branch
 *   does not? Retention says a ref is OLD ENOUGH to prune; this says it is SAFE
 *   to prune. Both must agree, and this one is the veto.
 *
 *   Why a file-level check rather than a commit-level one. A backup exists
 *   BECAUSE history was rewritten, so its commits have different SHAs than
 *   their landed counterparts and `merge-base --is-ancestor` reports every one
 *   of them unreachable — the check reads as "all unique" for a backup whose
 *   work landed in full. Squashing breaks patch-id matching (`git cherry`) the
 *   same way. What survives a rewrite is the CONTENT, so that is what gets
 *   compared: a file present on the backup and absent from the default branch
 *   is work the rewrite lost, and removing that ref leaves no other copy.
 *
 *   This is not hypothetical. The rewrite that prompted this script was
 *   verified by exactly this comparison, and a sibling rewrite in the same week
 *   lost four commits outright while a SHA-ancestry check still looked clean.
 *
 *   Deliberately conservative: it answers "is anything only here?", not "is
 *   every byte accounted for." A modified file whose backup version has a
 *   paragraph the default branch no longer carries will NOT be flagged, because
 *   a rewrite legitimately supersedes file contents on nearly every run and
 *   flagging that would veto every prune forever. Whole-file absence is the
 *   signal that separates lost work from superseded work.
 */

// A `git diff --diff-filter=D --name-only <backup> <default>` line: a path that
// exists on the backup side and not on the default side.
export interface UniqueContentReport {
  readonly branch: string
  // Paths present on the backup and missing from the default branch.
  readonly onlyOnBackup: readonly string[]
}

export function hasUniqueContent(report: UniqueContentReport): boolean {
  return report.onlyOnBackup.length > 0
}

/**
 * True when a ref is older than the default branch's ROOT commit — it predates
 * the current history entirely.
 *
 * This is the squash-history case, and it changes what a veto MEANS. A repo
 * carrying the `squash-history` opt-in periodically collapses its default
 * branch to a fresh root, which erases every removal commit along with
 * everything else. After that, "this file is on the backup and not on main"
 * says nothing about whether the file was deliberately removed or accidentally
 * lost — the evidence that would distinguish them is gone. A two-week-old
 * backup will list a fortnight of ordinary architecture churn (a bundling
 * migration, retired checks) as though every path were dropped work.
 *
 * The ref is still HELD either way; the gate stays fail-safe. What changes is
 * the claim the report makes, because "a rewrite may have lost work" is a
 * finding, and asserting it on every pre-root ref would train an operator to
 * ignore the one time it is real.
 */
export function precedesHistoryRoot(
  refCommittedAtMs: number,
  historyRootMs: number,
): boolean {
  return refCommittedAtMs < historyRootMs
}

/**
 * The `git diff` argv that answers the question, given two committish refs.
 *
 * `--diff-filter=D` on `diff <backup> <default>` selects paths absent from the
 * default side, which is precisely "present on backup, missing on default."
 * Argv rather than a command string so no path needs shell quoting.
 */
export function uniqueContentDiffArgs(
  backupRef: string,
  defaultRef: string,
): string[] {
  return ['diff', '--diff-filter=D', '--name-only', '-z', backupRef, defaultRef]
}

/**
 * Parse `git diff --name-only -z` output into paths.
 *
 * NUL-delimited because a repo can carry a path with a newline in it; `-z` also
 * turns off the quoting/escaping git otherwise applies to unusual bytes, so the
 * names come back verbatim.
 */
export function parseUniqueContentPaths(stdout: string): string[] {
  const out: string[] = []
  const entries = stdout.split('\0')
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (entry !== '') {
      out.push(entry)
    }
  }
  return out
}
