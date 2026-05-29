---
name: agent-ci
description: Run this repo's GitHub Actions workflows locally in Docker with Agent CI to validate changes before pushing. Use before opening or updating a PR, after editing a workflow YAML under .github/workflows, or whenever catching a CI failure locally beats waiting on a remote runner.
user-invocable: true
allowed-tools: Bash, Read, Edit
---

# agent-ci

Run the repo's CI pipeline locally before pushing. CI was green before you started, so any failure the local run surfaces comes from your changes.

RedwoodJS wrote the upstream tool and skill (MIT, https://github.com/redwoodjs/agent-ci). The fleet pins `@redwoodjs/agent-ci` in the wheelhouse catalog and runs it through `pnpm exec`, never `npx`. Edit only in `socket-wheelhouse/template/`; the cascade refreshes downstream copies.

## Requirements

- **Docker must be running** — each job runs in a container. No daemon means the run can't start; fall back to the `greening-ci` skill or remote CI.
- **The dep is already installed** — `@redwoodjs/agent-ci` is a fleet devDependency (`catalog:`), provisioned by `pnpm install`.

## Run

```bash
pnpm exec agent-ci run --quiet --all --pause-on-failure
```

`--all` runs the PR/push workflows for the current branch. `--pause-on-failure` stops at the first failed step and holds the container open for `retry`. Pipes are safe: when stdout is not a TTY the launcher detaches and the foreground process exits **77** the moment a step pauses, so `| tee log` and `> log.txt` work.

## Fix and retry

When a step fails the run pauses. Fix the code, then retry the paused runner — don't restart the whole pipeline:

```bash
pnpm exec agent-ci retry --name <runner-name>
```

Re-run from an earlier step with `--from-step <N>`. Repeat fix → retry until every job passes. Don't push to trigger remote CI when agent-ci can run it locally.

## Reference

- **Machine-readable `--json` event stream, the full requirements rationale, and the agent-ci-vs-remote-CI decision matrix**: see [reference.md](reference.md).
