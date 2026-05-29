# agent-ci reference

## Contents

- Machine-readable output (`--json`)
- The exit-77 pause contract
- Requirements rationale (Docker, install)
- When to use agent-ci vs. remote CI
- Command summary

## Machine-readable output (`--json`)

Add `--json` (or set `AGENT_CI_JSON=1`) to emit an NDJSON event stream on stdout — one JSON object per line. Use it for programmatic monitoring instead of grepping plaintext.

Events:

- `run.start` — carries `schemaVersion: 1` and `runId`.
- `job.start`, `job.finish` — `status: passed | failed`.
- `step.start`, `step.finish` — `status: passed | failed | skipped`.
- `run.paused` — carries `runner` and `retry_cmd` (the exact command to resume).
- `run.finish` — `status: passed | failed`.
- `diagnostic` — non-fatal notices.

`--json` is independent of `--quiet`. The diff renderer is auto-suppressed under `--json` so ANSI escapes don't collide with the stream.

The robust agent loop: parse the stream, react to `run.paused` (fix the failure named in `runner`), then run the `retry_cmd` it carries. No plaintext parsing required.

## The exit-77 pause contract

When stdout is not a TTY (piped, redirected, captured by a parent process), the launcher detaches the run. The foreground process exits **77** the instant a step pauses. This frees the pipe — `| tee`, `> log.txt`, command substitution — while the container stays paused in the background, ready for `retry`. Exit 77 means "paused, awaiting retry," not "failed."

## Requirements rationale

- **Docker.** agent-ci executes each workflow job inside a container, the same way GitHub's runners do. Without a running Docker daemon the run cannot start. There is no degraded mode; use `greening-ci` (push and watch remote CI) instead.
- **Install.** `@redwoodjs/agent-ci` is a fleet devDependency declared as `catalog:` in every repo's `package.json`, pinned in the wheelhouse `pnpm-workspace.yaml` catalog. `pnpm install` provisions it. The published package is a self-contained Node CLI (`dist/cli.js`) — it has no platform-binary dependencies and its `ssh2` native build scripts are declined in the fleet's `allowBuilds`/`allowScripts` (the CLI runs without them).

## When to use agent-ci vs. remote CI

| Situation | Use |
| --- | --- |
| Edited a workflow YAML (`.github/workflows/*.yml`) | agent-ci first — a malformed workflow fails the same locally and remotely, skipping the push/wait loop. |
| Code change that only needs lint / typecheck / unit tests | `pnpm run check --all` — faster than spinning up containers for the pure-Node gates. |
| Workflow does something the local scripts don't (matrix, container steps, action wiring, secrets-shaped env) | agent-ci. |
| No Docker, or the failure needs an off-machine action (a deploy, a remote service) | push and use `greening-ci`. |

## Command summary

| Command | Purpose |
| --- | --- |
| `pnpm exec agent-ci run --all --pause-on-failure` | Run the branch's PR/push workflows; pause on first failure. |
| `pnpm exec agent-ci run --workflow <path>` | Run a single workflow file. |
| `pnpm exec agent-ci retry --name <runner>` | Resume a paused runner after a fix. |
| `pnpm exec agent-ci retry --name <runner> --from-step <N>` | Resume from an earlier step. |

Add `--quiet` to suppress the live renderer, `--json` for the NDJSON stream.
