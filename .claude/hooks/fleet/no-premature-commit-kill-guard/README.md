# no-premature-commit-kill-guard

PreToolUse Bash hook. Blocks three anti-patterns — a git/test operation wedged or torn down in a context that can't complete it:

1. **Backgrounding a `git commit`** (or `rebase` / `merge` / `cherry-pick`) via `run_in_background: true`.
2. **`pkill` / `kill` / `killall` of a `git commit` / `git push`, a `pre-commit` / `pre-push` hook process, or a `vitest` run.** The worker-scoped reap `vitest/dist/workers` is exempt.
3. **`agent-ci run … --pause-on-failure`** — the canonical `ci:local` shape, direct or via the `agent-ci-skip-locks.mts run` wrapper. That flag holds the run at the first failing step waiting for an interactive keypress; a non-interactive agent can never answer it, so the run parks forever AND pins the worktree's `.git/index.lock`, wedging every concurrent `git commit` in that checkout.

## Why

A `git commit` (and the other three, which also fire the pre-commit chain) runs the staged-test reminder. That reminder is **bounded to ~60s** (`STAGED_TEST_TIMEOUT_MS` in `.git-hooks/_shared/helpers.mts`) but still takes real time on a non-trivial staged set. A commit that is "still running" before that bound elapses is **not a hang**.

The failure loop this guard breaks:

- Backgrounding the commit hides the bounded run's completion. The operator checks too early, sees it "still going", and concludes it hung.
- Then a `pkill` / `kill` of the git op (or the vitest it spawned) tears down a mid-hook run. That leaves a stale `.git/index.lock` (index corruption — the next git op fails with "Another git process seems to be running") and leaks vitest worker processes that pile up across attempts.
- A `git push` has the same shape — its pre-push gate is also bounded. Worse, a **broad** kill pattern (`pkill -f "git push"`, `pkill -f pre-push`) matches the same op in **every sibling checkout**, so it can reap a parallel session's in-flight push in another repo. If a kill is genuinely needed, scope the pattern to a full repo path (`pkill -f "<repo>/.git-hooks/.../pre-push"`) and verify the PID's cwd first (`lsof -a -p <pid> -d cwd -Fn`).

Running the op in the **foreground** and waiting for the bounded hook avoids the whole loop. CI / the merge gate run the full suite regardless, so nothing is lost by letting the local bounded reminder finish.

## Detection

AST-parsed via `_shared/shell-command.mts` (`findInvocation` / `commandsFor`), never a raw regex on the line:

- `run_in_background === true` **and** the command invokes `git commit` / `git rebase` / `git merge` / `git cherry-pick`.
- a `pkill` / `kill` / `killall` whose args reference `git commit` / `git push`, a `pre-commit` / `pre-push` hook process, or a bare `vitest` run. Two non-matches: a `kill <pid>` of an unrelated process (no git/test token), and `pkill -f "vitest/dist/workers"`, the blessed orphan-reap — the hook must not block its own recommended recovery.
- `agent-ci run` (binary or the `agent-ci-skip-locks.mts run` wrapper) **and** the command text carries `--pause-on-failure`. A non-pausing `agent-ci run --all --quiet` is **not** matched — it exits on failure and is safe headless. This arm is independent of `run_in_background`: the harness may auto-background a slow foreground command, so the flag in the payload can't be relied on; the command shape is matched directly.

## Bypass

`Allow background-git bypass` typed verbatim in a recent user turn — for the rare genuinely-long migration commit you will babysit out of band, or to reap a confirmed-dead leaked vitest after the commit has already exited.

## Failing open

Parse / payload errors exit 0. A guard bug must not block unrelated Bash.

## Related

- `.git-hooks/_shared/helpers.mts` — `runStagedTestsReminder` + the `STAGED_TEST_TIMEOUT_MS` bound this guard relies on.
- `stale-process-sweeper/` — reaps genuine orphan workers at turn end.
- CLAUDE.md → "Background Bash".
