/**
 * @file Shared parsing of a `git commit` Bash command — does it invoke commit,
 *   and what inline `-m` / `--message` subject does it carry. Imported by both
 *   `commit-message-format-guard` (CC-format check) and
 *   `no-placeholder-commit-subject-guard` (junk-subject check) so the two parse
 *   the command identically and never drift. Lives in `_shared/` rather than in
 *   a guard's `index.mts` because a guard module runs `withBashGuard` at load —
 *   importing it for its helpers would fire that guard as a side effect.
 *   Detection and extraction ride the shell-quote-backed AST parser, never a
 *   raw regex over the command string: a literal `git commit -m x` inside a
 *   quoted script body (`node -e '…"git commit -m x"…'`) or a prose mention
 *   inside another command's string argument is NOT a commit invocation and
 *   must not fire the guards (live incident: a parse probe's embedded literal
 *   was blocked as a malformed commit).
 */

import { commandsFor } from './shell-command.mts'

import type { Command } from './shell-command.mts'

// Git global options that take a SEPARATE value token (`git -C /path
// commit`, `git -c k=v commit`, `git --git-dir /x commit`). Their values are
// non-flag tokens that would otherwise shadow the real subcommand, so the
// subcommand scan must skip the flag AND its value. `=`-joined forms
// (`--git-dir=/x`) start with `-` and are skipped by the flag branch.
const GIT_GLOBAL_VALUE_FLAGS = new Set([
  '--git-dir',
  '--namespace',
  '--work-tree',
  '-C',
  '-c',
])

/**
 * The subcommand verb of a parsed `git` segment: the first non-flag arg
 * after skipping the values of value-taking global options. Undefined when
 * the segment has no subcommand (`git --version`).
 */
export function gitSubcommand(segment: Command): string | undefined {
  const { args } = segment
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (GIT_GLOBAL_VALUE_FLAGS.has(arg)) {
      i += 1
      continue
    }
    if (arg.startsWith('-')) {
      continue
    }
    return arg
  }
  return undefined
}

/**
 * The parsed `git commit` segments of `command`. Exported so callers with
 * segment-level concerns (an `--amend` exclusion, an author-override scan)
 * share the ONE subcommand parse instead of growing a divergent copy.
 */
export function gitCommitSegments(command: string): Command[] {
  return commandsFor(command, 'git').filter(c => gitSubcommand(c) === 'commit')
}

/**
 * True when `command` invokes `git commit` as a real shell segment — a
 * quoted literal inside another command's string argument does not count.
 */
export function isGitCommit(command: string): boolean {
  return gitCommitSegments(command).length > 0
}

/**
 * Extract the inline message from `git commit -m …` / `--message=…` forms.
 * Returns undefined when the command has no inline message (uses `-F file`,
 * `-e` editor, or neither) — those forms are owned by the editor / file, not
 * this parse. Multiple `-m` flags concatenate with blank-line separators
 * (matching git); the first line of the joined result is the header. The
 * values come from the parsed segment's args, already unquoted with embedded
 * newlines intact.
 */
export function extractCommitMessage(command: string): string | undefined {
  const pieces: string[] = []
  for (const segment of gitCommitSegments(command)) {
    const { args } = segment
    for (let i = 0, { length } = args; i < length; i += 1) {
      const arg = args[i]!
      if (arg === '-m' || arg === '--message') {
        const value = args[i + 1]
        if (value !== undefined) {
          pieces.push(value)
          i += 1
        }
        continue
      }
      if (arg.startsWith('--message=')) {
        pieces.push(arg.slice('--message='.length))
      }
    }
  }
  if (pieces.length === 0) {
    return undefined
  }
  return pieces.join('\n\n')
}
