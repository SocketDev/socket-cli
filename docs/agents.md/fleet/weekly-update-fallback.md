# Weekly-update: gh-aw primary + plain fallback

The fleet's weekly dependency update runs two ways. The gh-aw workflow is the primary scheduled path; the plain runner is the escape hatch and the local-dev entry. Both apply the same update.

## Primary: the gh-aw workflow

`socket-registry/.github/workflows/weekly-update.lock.yml` (compiled from `weekly-update.md`) runs the update as a GitHub Agentic Workflow. It adds three things a plain job can't: a per-run and 24h AI-credit budget, a firewall egress allowlist for the agent, and a web-flow-signed safe-output PR. The 12 fleet delegators `uses:` it on a schedule. This is what runs in production.

## Fallback: `pnpm run weekly-update` (plain, non-gh-aw)

`scripts/fleet/weekly-update.mts` runs the same flow as an ordinary process, so the update is reachable without the gh-aw runtime: locally on a dev machine, or as a plain CI job. It is byte-identical across the fleet (cascaded with the rest of `scripts/fleet/`).

Flow, mirroring the gh-aw `.md`:

1. **check-updates gate** — `pnpm outdated`, lockstep `--json` exit 2, submodule-behind. No-op exit when nothing is actionable.
2. **deterministic update (always)** — delegates to `update.mts` (taze two-pass + lockfile). The judgment-free npm/lockfile part.
3. **agentic update (optional)** — if a Claude agent is on PATH, invoke the `/updating` umbrella via the locked-down `spawnAiAgent` (`AI_PROFILE.full`, the four-flag lockdown). No agent → log a skip note and keep the deterministic result. A missing key never fails the run.
4. **test** — the configured setup + test commands.
5. **PR** — with `--pr`, open a PR via `gh`; otherwise leave the branch for the human to review.

### Flags (mirror the gh-aw inputs)

| Flag | Default | Effect |
| ------ | --------- | -------- |
| `--test-setup-script <cmd>` | `pnpm run build` | pre-test command |
| `--test-script <cmd>` | `pnpm test` | test command |
| `--update-model <model>` | `haiku` | model for the agentic step |
| `--pr-base <branch>` | repo default | PR base branch |
| `--pr-title-prefix <text>` | `chore(deps): weekly dependency update` | PR title prefix (date appended) |
| `--no-agent` | (agent on) | force deterministic-only (offline path) |
| `--pr` / `--no-pr` | `--no-pr` | open a PR (CI passes `--pr`); local default leaves the branch |

### When to reach for the fallback

- A local dev wants to run the update by hand: `pnpm run weekly-update` (then review + `--pr` or commit manually).
- gh-aw is unavailable (outage, a repo not yet onboarded to gh-aw, a constrained CI runner): a plain workflow runs `pnpm run weekly-update --pr`.
- An offline or no-key environment: `--no-agent` still does the deterministic update.

The two paths share the same update logic; the difference is the wrapper (budget + sandbox + signed-PR for gh-aw, none for the plain runner).

## The fallback CI workflow (shipped disabled)

`.github/workflows/weekly-update-non-gh-aw.yml.disabled` is the non-gh-aw fallback as a GitHub job. It ships **disabled**: GitHub only loads `*.yml`/`*.yaml` in `.github/workflows/`, so the `.yml.disabled` extension keeps it **invisible in every repo's Actions list and unrunnable**. It cascades fleet-wide, so every repo carries the fallback, but it stays dormant and clutter-free until needed.

To use it, toggle it with `scripts/fleet/weekly-update-workflow.mts`:

| Command | Effect |
| --------- | -------- |
| `node scripts/fleet/weekly-update-workflow.mts status` | report shipped / enabled state |
| `… enable` | copy `…non-gh-aw.yml.disabled` → `…non-gh-aw.yml` (now live + listed) |
| `… disable` | remove the live copy (back to dormant) |
| `… run` (= `pnpm run weekly-update:ci`) | enable → run it via Agent CI → re-disable, even on failure |

The enabled `…non-gh-aw.yml` copy is gitignored, so it is transient and never committed — the `.disabled` file stays canonical. When live, the workflow is `workflow_dispatch`-only (it must not compete with the gh-aw schedule): it checks out, sets up via the fleet `setup-and-install` action, and runs `pnpm run weekly-update` with the dispatch inputs. The agentic step runs only if `ANTHROPIC_API_KEY` is set; without it the job does the deterministic update and (if `open-pr`) still opens the PR.

`run` is also how Agent CI exercises the fallback: Agent CI can't see a `.disabled` file (GitHub ignores it too), so the workflow must be enabled for the run and re-hidden after. (Agent CI also can't simulate the gh-aw `.lock.yml` — this fallback is the plain workflow it CAN run.)
