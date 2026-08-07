# Stop means stop forward action

"stop", "pause", "hold off" mean **start no new work**. They do not mean freeze
wherever the turn happens to be. The two readings look alike and are not: one
ends with the work landed, the other leaves a half-applied change on disk for the
next session to find.

## The rule

- **Stop forward action, not the landing.** No new investigation, no new
  refactor, no next queue item. Finishing what is already in flight is not
  forward action.
- **Mid-commit: finish the commit.** If the change is staged, or the gate is
  running, carry it through: format, lint, commit, then report. A pre-commit gate
  working through its lint and tests is the state that most looks like a stopping
  point and least is one.
- **Never interrupt a running commit command.** A `git commit` in flight owns the
  index. Killing it leaves an `index.lock` the next turn has to clear before it
  can do anything. Same for a merge, rebase, or cherry-pick sequence mid-run.
  Wait for it.
- **Uncommitted with nothing in flight: land it, then report.** Get the gate
  green and commit. If another actor's WIP blocks the gate, stage your own paths
  explicitly (`git add <path>`) rather than leaving yours uncommitted.
- **Report after landing, not instead of it.** "Here is the broken state, I
  stopped" is the failure this rule exists to prevent.
- **An inverted ask is not a stop.** "Don't stop until the tests pass" and "stop
  once CI is green" tell you to keep going. Read the instruction, not the word.

## Enforcement

- `stop-means-commit-guard` (Stop, every repo) BLOCKS a turn-end when the latest
  HUMAN turn asked to pause and this session's own work is uncommitted in the
  primary checkout, and it names the paths. It stands down while a commit is in
  flight, in a linked git worktree, or on the phrase its README documents.
- `dont-stop-mid-queue-nudge` reads the same definition for the opposite reason:
  it stands down when the user authorized stopping.
- Both consume `_shared/stop-request.mts` — one definition of what a stop request
  is and when a commit is in flight, so the two can never disagree about whether
  a turn was allowed to end.

## Why

The misread already happened. A turn paused with a dirty tree and a red lint
gate, reported that state, and stopped. `dirty-worktree-stop-guard` did not catch
it, because an announced pause is one of its sanctioned escapes — so the pause
that was meant to mean "land this and tell me where we are" was read as
permission to leave the tree broken.

Related: `worktree-hygiene` (finish a change, then commit it), and `vocabulary`
("land" means a local commit, never a push).
