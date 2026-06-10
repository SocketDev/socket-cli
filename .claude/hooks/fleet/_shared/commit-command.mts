/**
 * @file Shared parsing of a `git commit` Bash command — does it invoke commit,
 *   and what inline `-m` / `--message` subject does it carry. Imported by both
 *   `commit-message-format-guard` (CC-format check) and
 *   `no-placeholder-commit-subject-guard` (junk-subject check) so the two parse
 *   the command identically and never drift. Lives in `_shared/` rather than in
 *   a guard's `index.mts` because a guard module runs `withBashGuard` at load —
 *   importing it for its helpers would fire that guard as a side effect.
 */

/**
 * True when `command` invokes `git commit` (tolerating `git -c k=v` flags
 * before the subcommand).
 */
export function isGitCommit(command: string): boolean {
  return /\bgit\b(?:\s+-c\s+\S+)*\s+commit(?:\s|$)/.test(command)
}

/**
 * Extract the inline message from `git commit -m …` / `--message=…` forms.
 * Returns undefined when the command has no inline message (uses `-F file`,
 * `-e` editor, or neither) — those forms are owned by the editor / file, not
 * this parse. Multiple `-m` flags concatenate with blank-line separators
 * (matching git); the first line of the joined result is the header.
 */
export function extractCommitMessage(command: string): string | undefined {
  const matches = [
    ...command.matchAll(
      /(?:^|\s)-m\s+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+))/g,
    ),
    ...command.matchAll(
      /--message(?:\s+|=)(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+))/g,
    ),
  ]
  if (matches.length === 0) {
    return undefined
  }
  const pieces = matches.map(m => m[1] ?? m[2] ?? m[3] ?? '')
  return pieces.join('\n\n')
}
