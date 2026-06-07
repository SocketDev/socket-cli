---
description: Watch a repo's CI run, fix failures, push, and confirm green. Modes — fast (ci.yml), release (build-server matrices), cool (confirm rest of matrix).
---

Watch the latest CI run for `$ARGUMENTS` and drive it back to green.

`$ARGUMENTS` is parsed as: `<owner/repo>` `[workflow.yml]` `[--mode fast|release|cool]` `[--branch main]`. Defaults: workflow=`ci.yml`, mode=`fast`, branch=the repo's default.

## Process

1.  Invoke the `greening-ci` skill runner:

        node .claude/skills/fleet/greening-ci/run.mts --repo <owner/repo> [--workflow <name>] [--mode <fast|release|cool>] [--branch <ref>]

    Parse the final stdout line as JSON.

2.  Branch on `conclusion`:
    - `"success"` — Done. Report the run URL and exit.

    - `"failure"` — Read `failedJobs[0].logTailPath`, classify the failure against the table in the `greening-ci` SKILL.md (under `.claude/skills/greening-ci/`). Apply the fix locally in the target repo (clone or worktree as needed per the parallel-Claude-sessions rule). Commit + push. Re-invoke this command to confirm green.

    - `null` (run still in progress but a job already failed) — Treat as `"failure"`. Don't wait for the rest of the run to finish; the branch protection will cancel sibling jobs once one fails.

    - `"cancelled"` / `"skipped"` — Surface to user; don't auto-fix.

3.  Loop until the run is green or 5 fix-and-push iterations complete (whichever first). Each iteration:
    - Reads the latest failure log tail.
    - Applies a targeted fix (no shotgun rewrites).
    - Commits with a `fix(<scope>):` Conventional Commits message that names the failing step.
    - Pushes.
    - Re-invokes the skill in the same mode.

4.  After 5 iterations without green, **stop**. Report what was tried and ask the user.

## Mode picker

- **`fast`** — default. For `ci.yml`. 30s polls, stop on first failure or full success.
- **`release`** — for `build-<tool>.yml` build-server dispatches. 30s polls, stop on first matrix-slot outcome (success or failure). After a first success, the orchestrator switches to `cool` for the rest.
- **`cool`** — 120s polls. Just confirming the remainder of an already-partially-succeeded matrix.

If the user types `/green-ci socket-btm ci.yml` we run `fast`. If they type `/green-ci socket-btm build-curl.yml` (any non-ci.yml filename), default to `release` unless they explicitly pass `--mode fast`.

## Rules

- **Never push to a protected branch without confirming.** If the target repo blocks direct push to main, open a PR instead (use the fleet's push-or-PR pattern; see `scripts/fleet/cascade-fleet.mts` in this repo for the canonical implementation).
- **Each fix is one commit.** Don't bundle the CI fix with unrelated changes — the commit message should let a future reader understand exactly which failing step it addresses.
- **Don't bump cache versions just to mask a real bug.** If the failure is a cache miss + downstream code that can't handle a fresh cache, fix the downstream code. Only bump the cache version when the cached artifact itself is staler than the source.
- **Escalate, don't paper over, GH org policy failures.** "Action not allowed by enterprise admin" requires the org-level allowlist update; the repo can't fix it. Tell the user.

## Anti-patterns

- Polling tighter than 30s — GH rate limits apply.
- Auto-fixing flaky-looking failures without classifying — re-running ≠ fixing.
- Treating a queued-too-long run as broken — sometimes the runner pool is just busy.
- Pushing to a release tag's CI failure — release CI failures are usually upstream-policy or token-rotation, not code. Get the user.

## Example call sites

    /green-ci socket-btm
    /green-ci socket-btm ci.yml
    /green-ci socket-btm build-curl.yml --mode release
    /green-ci socket-btm build-node-smol.yml --mode cool
    /green-ci socket-cli ci.yml --branch refs/pull/123/head
