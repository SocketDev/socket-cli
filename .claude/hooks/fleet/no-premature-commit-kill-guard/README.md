# no-premature-commit-kill-guard

PreToolUse Bash hook. Blocks two anti-patterns that share one root cause:

1. **Backgrounding a `git commit`** (or `rebase` / `merge` / `cherry-pick`) via `run_in_background: true`.
2. **`pkill` / `kill` / `killall` of a `git commit` or `vitest`** process.

## Why

A `git commit` (and the other three, which also fire the pre-commit chain) runs the staged-test reminder. That reminder is **bounded to ~60s** (`STAGED_TEST_TIMEOUT_MS` in `.git-hooks/_shared/helpers.mts`) but still takes real time on a non-trivial staged set. A commit that is "still running" before that bound elapses is **not a hang**.

The failure loop this guard breaks:

- Backgrounding the commit hides the bounded run's completion. The operator checks too early, sees it "still going", and concludes it hung.
- Then a `pkill` / `kill` of the git-commit (or the vitest it spawned) tears down a mid-pre-commit run. That leaves a stale `.git/index.lock` (index corruption — the next git op fails with "Another git process seems to be running") and leaks vitest worker processes that pile up across attempts.

Running the commit in the **foreground** and waiting for the bounded pre-commit avoids the whole loop. CI / the merge gate run the full suite regardless, so nothing is lost by letting the local bounded reminder finish.

## Detection

AST-parsed via `_shared/shell-command.mts` (`findInvocation` / `commandsFor`), never a raw regex on the line:

- `run_in_background === true` **and** the command invokes `git commit` / `git rebase` / `git merge` / `git cherry-pick`.
- a `pkill` / `kill` / `killall` whose args reference a `git commit` or `vitest` target. A `kill <pid>` of an unrelated process is not matched (no git/vitest token).

## Bypass

`Allow background-git bypass` typed verbatim in a recent user turn — for the rare genuinely-long migration commit you will babysit out of band, or to reap a confirmed-dead leaked vitest after the commit has already exited.

## Failing open

Parse / payload errors exit 0. A guard bug must not block unrelated Bash.

## Related

- `.git-hooks/_shared/helpers.mts` — `runStagedTestsReminder` + the `STAGED_TEST_TIMEOUT_MS` bound this guard relies on.
- `stale-process-sweeper/` — reaps genuine orphan workers at turn end.
- CLAUDE.md → "Background Bash".
