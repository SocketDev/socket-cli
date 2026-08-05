/*
 * @file One definition of "which `git stash` invocations only READ".
 *
 *   `git stash` is a destructive family, so several guards block it. Matching
 *   the bare subcommand catches `list` and `show` too, and those only print —
 *   `list` enumerates the stash entries, `show` diffs one. Blocking them stops
 *   the read that answers "is anything stashed here?", which is the question
 *   worth asking BEFORE reaching for a bypass.
 *
 *   The carve-out is READ-ONLY, not stash-preserving. `apply` and `branch`
 *   leave the stash intact and still mutate the working tree, so they stay
 *   blocked alongside `push`, `save`, `store`, and the bare form. `clear`,
 *   `drop`, and `pop` destroy stash entries outright.
 *
 *   Shared because two guards had the same blind spot independently:
 *   no-revert-guard and parallel-agent-staging-guard. Fixing one left the other
 *   still refusing `git stash list`, which is how the duplicate surfaced — the
 *   unit fix passed while the real command stayed blocked.
 */

import { commandsFor } from './shell-command.mts'
import { gitSubcommandReadings } from './git-subcommand.mts'

// `git stash` actions that print and change nothing.
const READ_ONLY_STASH_ACTIONS: ReadonlySet<string> = new Set(['list', 'show'])

/**
 * True when `action` names a `git stash` subcommand that only reads.
 *
 * `undefined` — a bare `git stash` — is NOT read-only: it pushes a new entry.
 */
export function isReadOnlyStashAction(action: string | undefined): boolean {
  return action !== undefined && READ_ONLY_STASH_ACTIONS.has(action)
}

/**
 * True when `command` contains a `git stash` invocation that MUTATES — the
 * stash store, the working tree, or both.
 *
 * A command whose every stash invocation is `list` or `show` answers false, so
 * a guard can let the read through while still blocking the rest. Parsed rather
 * than regex-matched, so a chain, a substitution, or a quoted mention resolves
 * the same way the other git detectors resolve it.
 */
export function mutatesStash(command: string): boolean {
  return commandsFor(command, 'git').some(c =>
    gitSubcommandReadings(c.args).some(({ rest, sub }) => {
      if (sub !== 'stash') {
        return false
      }
      // The first positional after `stash` is the action. A flag-led form
      // (`git stash --keep-index`) has no action and is the bare push.
      const action = rest.find(arg => !arg.startsWith('-'))
      return !isReadOnlyStashAction(action)
    }),
  )
}
