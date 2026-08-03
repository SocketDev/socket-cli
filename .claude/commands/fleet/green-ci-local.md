---
description: Drive a repo's CI to green LOCALLY with Agent-CI (Docker) — run a workflow in containers, fix the first paused failure, retry in place, loop until green. The local pre-flight before a push or a remote build-matrix dispatch.
---

Run `$ARGUMENTS` through Agent-CI locally and drive it to green without a push or
remote runner minutes.

`$ARGUMENTS` is parsed as: `[workflow.yml]` `[--no-matrix]`. Default: all PR/push
workflows for the current branch (`pnpm run ci:local`). Pass a workflow path to
validate one (e.g. a release/build workflow before dispatching it remotely);
`--no-matrix` collapses a matrix to one representative leg for a fast first pass.

Requires Docker running (OrbStack on macOS — `open -a OrbStack`, confirm
`docker info`). On a paused step the model reads the failure log, fixes the code
locally, and re-invokes the runner with `--retry <runner-name>` to resume the
SAME runner — it does not restart the pipeline. Env-gap failures (Depot/OIDC,
runner-only libs, skipped macOS legs) are classified and reported as the local
boundary, not code defects, and still need the remote run.

The local twin of `/green-ci` (which watches GitHub Actions remotely + pushes
fixes). Use this first to catch breaks in containers; use `/green-ci` for the
remote run that produces real release artifacts.

This command **defers to the `greening-ci-local` skill** — that skill's `run.mts`
is the eyes-only driver (launch Agent-CI `--pause-on-failure`, classify the
pause, print a JSON verdict); the skill body documents the fix-and-retry loop the
model runs over it. Invoke the skill and follow its loop:

    node .claude/skills/fleet/greening-ci-local/run.mts [--workflow .github/workflows/<wf>.yml] [--no-matrix]

Parse the final stdout line as JSON; branch on `status` (`green` / `paused` /
`error`) per the skill.
