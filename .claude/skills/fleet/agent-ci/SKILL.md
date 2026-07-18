---
name: agent-ci
description: Run this repo's GitHub Actions locally with Agent-CI before pushing workflow or CI-sensitive changes.
user-invocable: true
allowed-tools: Bash, Read, Edit
model: claude-haiku-4-5
context: fork
---

# agent-ci

Run the repo's CI pipeline locally before pushing. CI was green before you started, so any failure the local run surfaces comes from your changes.

RedwoodJS wrote the upstream tool and skill (MIT, https://github.com/redwoodjs/agent-ci). The fleet pins `@redwoodjs/agent-ci` in the wheelhouse catalog and wires it as the `ci:local` package script (resolved via `node_modules/.bin`, never `pnpm exec`/`npx`). Edit only in `socket-wheelhouse/template/`; the cascade refreshes downstream copies.

## Requirements

- **Docker must be running** — each job runs in a container. On macOS the fleet uses **OrbStack** (`open -a OrbStack`; recommended over Docker Desktop). If the daemon is down, agent-ci fails fast with `couldn't use a Docker socket at /var/run/docker.sock … missing or a dangling symlink` and exit 1 — that's the daemon, not a workflow failure. Start the provider, confirm with `docker info`, re-run. No daemon and can't start one → fall back to `greening-ci` (push + watch remote).
- **The dep is already installed** — `@redwoodjs/agent-ci` is a fleet devDependency (`catalog:`), provisioned by `pnpm install`.
- **`--github-token` for remote reusable workflows** — every socket-\* repo's `ci.yml` calls a `SocketDev/socket-registry/.github/workflows/…` reusable workflow. agent-ci can't fetch it without a token; pass `--github-token` (no value → auto-resolves via `gh auth token`). Omitting it makes a remote-reusable CI silently fail to resolve.
- **macOS jobs (`runs-on: macos-*`)** run in a throwaway VM and need `tart` + `sshpass` on an Apple Silicon host (`brew install cirruslabs/cli/tart hudochenkov/sshpass/sshpass`). Without both, macOS jobs are skipped with a reason — the rest of the run still proceeds.

## Run

The blessed entry is the canonical `ci:local` script — it already carries the full flag set (`--all --quiet --pause-on-failure --github-token`), and pnpm resolves the `agent-ci` binary from `node_modules/.bin` cross-platform:

```bash
pnpm run ci:local
```

`--all` runs the PR/push workflows for the current branch. `--quiet` suppresses the live renderer (pipe-safe). `--pause-on-failure` stops at the first failed step and holds the container open for `retry`. `--github-token` (bare → `gh auth token`) fetches the socket-registry reusable workflow every fleet `ci.yml` calls. Pipes are safe: when stdout is not a TTY the launcher detaches and the foreground process exits **77** the moment a step pauses, so `| tee log` and `> log.txt` work.

There is no `--list` or dry-run flag — `run` executes. Args after the subcommand pass through, so a typo'd flag becomes a workflow arg rather than an error.

To resolve the binary from a `.mts` script (not a package.json script — those resolve `node_modules/.bin` themselves), use the fleet helper, never a shelled-out `which`/`command -v` (which searches the global PATH and resolves the wrong binary — enforced by `socket/no-which-for-local-bin`):

```ts
import { whichSync } from "@socketsecurity/lib-stable/bin/which";

const agentCi = whichSync("agent-ci", {
  path: nodeModulesBinDir,
  nothrow: true,
});
```

## Fix and retry

When a step fails the run pauses (and the `run.paused` event carries the exact `retry_cmd` to copy). Fix the code, then retry the paused runner — don't restart the whole pipeline:

```bash
node_modules/.bin/agent-ci retry --name <runner-name>
```

Call the linked binary directly (the fleet form for an ad-hoc bin invocation, same as `node_modules/.bin/oxfmt` / `tsgo` in build scripts) — never `pnpm exec`/`npx`. Re-run from an earlier step with `--from-step <N>`. Repeat fix → retry until every job passes. Don't push to trigger remote CI when agent-ci can run it locally.

## Reference

- **Machine-readable `--json` event stream, the full requirements rationale, and the agent-ci-vs-remote-CI decision matrix**: see [reference.md](reference.md).

## Handoffs

Use [greening-ci-local](../greening-ci-local/SKILL.md) for the local fix-and-retry
loop, and [greening-ci](../greening-ci/SKILL.md) when a real runner is required.
