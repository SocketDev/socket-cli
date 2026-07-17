---
name: greening-ci-local
description: Run Agent-CI locally in Docker, fix paused failures, and retry until the workflow is green.
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

`run.mts` is **eyes-only**, the local twin of `greening-ci`'s runner: it launches
Agent-CI with `--pause-on-failure`, watches for the launcher's exit-77 (a step
paused) or a clean exit (green), dumps the paused-step log tail to a tmp file,
**classifies** the failure as code-vs-env-gap deterministically, and prints a
JSON verdict on its final line. The retry loop, the budget, and the env-gap
classification are all in the script — the **fix-authoring** stays yours.

1. **Invoke the runner.** A single workflow (the common case for validating one
   release/build workflow):
   `node .claude/skills/fleet/greening-ci-local/run.mts --workflow
   .github/workflows/<wf>.yml [--no-matrix]`. Omit `--workflow` to run all
   PR/push workflows for the branch. `--no-matrix` validates one representative
   leg fast before the full fan-out; `--budget-sec N` raises the wall-clock cap
   for a full local matrix.
2. **Parse the last stdout line as JSON.** Shape:
   ```json
   {
     "status": "green" | "paused" | "error",
     "runnerName": "build-curl-linux-x64" | null,
     "retryCmd": "agent-ci retry --name build-curl-linux-x64" | null,
     "classification": "code" | "env-gap" | null,
     "envGapReason": "Depot/OIDC is unavailable locally — needs a real runner" | null,
     "logTailPath": "/tmp/greening-ci-local.../paused-step.log" | null,
     "elapsedSec": 142
   }
   ```
3. **Branch on `status`:**
   - `"green"`: done. Every leg that can run locally passed. Report and exit.
   - `"paused"` + `classification: "code"`: read `logTailPath`, author the fix
     locally in the checkout (this is the genuine AI judgment — see the
     classification table in the remote `greening-ci` SKILL.md for the common
     patterns), then re-invoke the runner with `--retry <runnerName>` (add
     `--from-step <N>` to skip earlier passing steps). This resumes the SAME
     paused runner — never a full pipeline restart.
   - `"paused"` + `classification: "env-gap"`: the local boundary, not a defect
     (Docker base image missing a runner-only lib, Depot/OIDC unavailable, a
     macOS leg skipped for no tart). Record `envGapReason`, abort the runner if
     needed, and report "green up to <step>; <leg> needs a real runner."
   - `"error"`: Agent-CI itself failed before a pausable step (bad args, daemon
     down, workflow parse error). Read `logTailPath` for the real cause; a
     `/var/run/docker.sock` error means the daemon, not a workflow failure.
4. **Loop** the runner until `status: "green"` (all non-skipped legs pass) or the
   budget expires.

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
