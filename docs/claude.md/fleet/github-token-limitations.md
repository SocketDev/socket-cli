# GITHUB_TOKEN cannot trigger other workflows

GitHub Actions suppresses every event created with the default `GITHUB_TOKEN` — pushes, `pull_request` open/close/reopen, issue events, tag creation. The only events that still fire are `workflow_dispatch` and `repository_dispatch`. This is a hardcoded platform behavior that prevents a workflow from recursively triggering itself.

**Why this matters:** an automated PR opened by a job using `GITHUB_TOKEN` (e.g. a `generate.yml` or `weekly-update.yml` flow) leaves required CI and enterprise-audit checks stuck at "Waiting for workflow to run" — the `pull_request` event that would start them never fires.

## What does NOT work

- Opening a PR with `GITHUB_TOKEN` and expecting CI to start.
- The `gh pr close` + `gh pr reopen` "kick it" workaround — the API call still acts as `GITHUB_TOKEN`, so reopen fires no event either.
- Pushing a branch with `GITHUB_TOKEN` and expecting a `push`-triggered workflow.

**Why:** discovered 2026-04-07 when automated PRs from `generate.yml` / `weekly-update.yml` sat with checks never starting; the close/reopen workaround was tried and also failed.

## What works

- A **PAT** or **GitHub App token** (not `GITHUB_TOKEN`) on the step that opens the PR / pushes — events it creates fire normally.
- `workflow_dispatch` / `repository_dispatch` from the same job — these are the two events `GITHUB_TOKEN` is allowed to raise, so a dispatch-driven downstream workflow is the supported chaining mechanism.

When designing a workflow that must trigger another workflow, reach for a dispatch event or a non-default token from the start; don't ship a `GITHUB_TOKEN` push/PR and discover the silence later.
