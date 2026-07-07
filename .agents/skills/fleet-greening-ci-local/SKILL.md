---
name: fleet-greening-ci-local
description: Drive a repo's CI to green LOCALLY with Agent-CI (Docker), the local analog of greening-ci. Runs a workflow (or all PR/push workflows) in containers, and on the first paused step reads the failure log, fixes the code locally, and `agent-ci retry`s the SAME paused runner — looping until the run lands green or a wall-clock budget expires. Use to validate a workflow change or a release dispatch BEFORE burning a remote run, to catch a CI failure on your own machine, or as the local pre-flight before `republishing-stubs` / any remote build-matrix dispatch. Where greening-ci watches GitHub Actions remotely and fixes-then-pushes, this runs in local containers and fixes-then-retries in place — no push, no remote runner minutes.
user-invocable: true
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git:*), Bash(node:*), Bash(pnpm:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(docker info:*), Bash(open -a OrbStack:*)
model: claude-sonnet-4-6
context: fork
---

# greening-ci-local

The local twin of `greening-ci`. Instead of watching GitHub Actions and
fixing-then-pushing, this runs the workflow in **local Docker containers via
Agent-CI** and fixes-then-**retries** in place. The win: catch a CI failure on
your own machine — before a push, before a remote build-matrix dispatch — without
spending remote runner minutes or shipping a half-broken release.

`greening-ci` (remote) and `greening-ci-local` (this) are siblings: same
fix-and-loop discipline, different engine. Reach for local when you want to
validate BEFORE the remote run exists; reach for remote when the run is already
dispatched (or the failure only reproduces on real runners — Depot/macOS VMs).

## Requirements (the same ones agent-ci needs)

- **Docker daemon up.** Each job runs in a container. On macOS the fleet uses
  **OrbStack** (`open -a OrbStack`; confirm with `docker info`). If it's down,
  agent-ci fails fast with a `/var/run/docker.sock` error — that's the daemon,
  not a workflow failure. Start it, confirm `docker info`, re-run. Can't start a
  daemon → fall back to `greening-ci` (push + watch remote).
- **`--github-token`** — every fleet `ci.yml` calls a `SocketDev/socket-registry`
  reusable workflow; agent-ci needs the token to fetch it (bare flag →
  `gh auth token`).
- **macOS matrix legs** need `tart` + `sshpass` on Apple Silicon; without them
  those legs are SKIPPED (the rest still run). Linux/musl legs run in Docker.
- Some legs genuinely can't run locally (Depot OIDC, runner-only system libs like
  `libatomic.so.1` missing from the base image). Treat an env-gap failure as
  "validated up to the local boundary," not a code defect — see Classify below.

## How it drives the fix-and-retry loop

1. **Pick the entry.** Whole branch CI: `pnpm run ci:local` (carries
   `--all --quiet --pause-on-failure --github-token`). A single workflow (the
   common case for validating one release/build workflow):
   `node_modules/.bin/agent-ci run --workflow .github/workflows/<wf>.yml
   --github-token --quiet --pause-on-failure [--no-matrix]`. Use `--no-matrix` to
   validate one representative leg fast before running the full fan-out.
2. **Run it.** Pipe-safe: stdout-not-a-TTY → the launcher detaches and the
   foreground process exits **77** the instant a step pauses. Capture output
   (`> /tmp/agentci-<wf>.log` or `| tee`).
3. **On pause (a failed step):** the `run.paused` event carries the runner name +
   the exact `retry_cmd`. Read the failure log tail, classify it:
   - **Code/config failure** → fix it locally in the checkout, then retry the
     SAME paused runner: `node_modules/.bin/agent-ci retry --name <runner-name>`
     (or `--from-step <N>` to skip earlier passing steps). Do NOT restart the
     whole pipeline — retry resumes from the fix.
   - **Env-gap failure** (Docker base image missing a lib the real runner has,
     Depot/OIDC unavailable locally, a macOS leg skipped for no tart) → this is
     the local boundary, not a defect. Record it, `agent-ci abort --name <runner>`
     if needed, and report "green up to <step>; <leg> needs a real runner."
4. **Loop** until the run lands green (all non-skipped legs pass) or the budget
   expires.

## Budgets

- Single non-matrix workflow: ~10 min wall-clock is plenty for the local legs.
- Full local matrix (Linux + musl): longer — Docker image pulls + per-leg builds.
  If a leg hasn't progressed in ~15 min it's wedged (image pull stall / disk),
  not slow; investigate rather than wait.

## Output

Report, per leg: passed / fixed-then-passed / skipped (why) / env-gap (which
step + that it needs a real runner). A run is "locally green" when every leg that
CAN run locally passed. Name any leg that could only be validated remotely so the
caller knows the remote dispatch still has to cover it.

## Relationship to remote greening-ci + republishing-stubs

- A clean `greening-ci-local` pass on a release/build workflow is the recommended
  **pre-flight** before the real remote dispatch — it catches code/config breaks
  in containers first. `republishing-stubs` Phase 0.5 calls this on `stubs.yml`.
- It does NOT replace the remote run for release artifacts: the local pass can't
  produce the real Depot cross-builds or sign/publish. After local-green, dispatch
  remotely and confirm with `greening-ci --mode=release`.
