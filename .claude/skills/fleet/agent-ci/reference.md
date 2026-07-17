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

- **Docker.** agent-ci executes each workflow job inside a container, the same way GitHub's runners do. It connects via `AGENT_CI_DOCKER_HOST` (default `unix:///var/run/docker.sock`) — **not** the standard `DOCKER_HOST` (setting `DOCKER_HOST` makes agent-ci exit with a rename error; use `AGENT_CI_DOCKER_HOST` for a remote `ssh://`/`tcp://` daemon). Without a running daemon the run cannot start; it fails fast with a dangling-socket message and exit 1. On macOS the fleet provider is **OrbStack** (`open -a OrbStack`, then `docker info` to confirm). There is no degraded mode; if you can't start a daemon, use `greening-ci` (push and watch remote CI) instead.
- **Remote reusable workflows.** A fleet `ci.yml` is INLINED (fleet-canonical block cascaded from socket-wheelhouse) — no remote fetch needed for it. But other workflows still `uses:` remote reusables (e.g. the `SocketDev/socket-registry` `weekly-update.yml` / `publish-npm.yml` delegators); running those needs `--github-token` (bare flag → `gh auth token`, or `AGENT_CI_GITHUB_TOKEN`) or the run can't assemble the job graph.
- **macOS jobs.** `runs-on: macos-*` jobs run in a real throwaway macOS VM via `tart` (Apple Silicon only) with `sshpass`. Missing either tool, or on Linux/Intel, those jobs **skip with a reason** rather than failing the run; the Linux/container jobs still execute. VM concurrency caps at `AGENT_CI_MACOS_VM_CONCURRENCY` (default 2 — tart's free tier). Windows jobs (`runs-on: windows-*`) always skip (unsupported).
- **Missing tools in the runner image.** Jobs run in `ghcr.io/actions/actions-runner:latest`, which ships node/git/curl/jq/unzip but **not** build toolchains, `python3`, or `xz`. A job failing on a missing tool isn't your code — add a `.github/agent-ci.Dockerfile` (`FROM ghcr.io/actions/actions-runner:latest` + `apt-get install`); agent-ci picks it up automatically and caches by content hash.
- **Install.** `@redwoodjs/agent-ci` is a fleet devDependency declared as `catalog:` in every repo's `package.json`, pinned in the wheelhouse `pnpm-workspace.yaml` catalog. `pnpm install` provisions it. The published package is a self-contained Node CLI (`dist/cli.js`) — it has no platform-binary dependencies and its `ssh2` native build scripts are declined in the fleet's `allowBuilds`/`allowScripts` (the CLI runs without them).

## When to use agent-ci vs. remote CI

| Situation                                                                                                    | Use                                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Edited a workflow YAML (`.github/workflows/*.yml`)                                                           | agent-ci first — a malformed workflow fails the same locally and remotely, skipping the push/wait loop. |
| Code change that only needs lint / typecheck / unit tests                                                    | `pnpm run check --all` — faster than spinning up containers for the pure-Node gates.                    |
| Workflow does something the local scripts don't (matrix, container steps, action wiring, secrets-shaped env) | agent-ci.                                                                                               |
| No Docker, or the failure needs an off-machine action (a deploy, a remote service)                           | push and use `greening-ci`.                                                                             |

## Command summary

| Command                                                              | Purpose                                                     |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm run ci:local`                                                  | Blessed entry — `agent-ci run --all` via `node_modules/.bin`. |
| `node_modules/.bin/agent-ci run --all --pause-on-failure --github-token` | Run the branch's PR/push workflows; pause on first failure; fetch remote reusable workflows. |
| `node_modules/.bin/agent-ci run --workflow <path>`                   | Run a single workflow file.                                 |
| `node_modules/.bin/agent-ci retry --name <runner>`                   | Resume a paused runner after a fix.                         |
| `node_modules/.bin/agent-ci retry --name <runner> --from-step <N>`   | Resume from an earlier step.                                |
| `node_modules/.bin/agent-ci abort --name <runner>`                   | Tear down a paused runner without retrying.                 |

Add `--quiet` to suppress the live renderer, `--json` for the NDJSON stream. Invoke the binary via `node_modules/.bin/agent-ci` or the `ci:local` script — never `pnpm exec`/`npx` (fleet tooling ban).
