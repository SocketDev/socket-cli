---
name: greening-ci
description: Drive a target repo's CI back to green. Watches GitHub Actions, surfaces the first failure log, fixes it locally, commits + pushes, and re-watches until the run lands green (or a wall-clock budget expires). Three modes — fast (ci.yml), release (build-server matrices, fail-fast 30s polls then cool down on first success), cool (just confirm the rest of a matrix). Use when main goes red, when a build-server dispatch is failing, or when babysitting a freshly-pushed fix to verify it lands green.
user-invocable: true
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(gh:*), Bash(git:*), Bash(node:*), Bash(pnpm:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*)
---

# greening-ci

Watch a target repo's CI, surface failures the moment they land, and drive a fix-and-push loop until the run is green.

## When to use

- **main is red.** Don't move on with new work while the trunk is broken. Run `/green-ci` to lock onto the failing run, fix it, push, and confirm green before resuming.
- **Build-server matrix dispatched and might fail fast.** Release builds (curl, lief, binsuite, node-smol) have one matrix slot that usually fails first. Use `--mode=release` to learn the failure ~5 minutes before the whole matrix finishes.
- **Verifying a just-pushed fix.** Push a fix, then run the skill — it'll poll, confirm the run lands green, and exit. No more "did my fix actually work" guessing.

## Three modes

| Mode      | Poll interval | Stop trigger                                                          | When to pick                                                                                          |
| --------- | ------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `fast`    | 30s           | Any job fails OR whole run completes                                  | Default. `ci.yml` watching — surface the failure as soon as one job lands.                            |
| `release` | 30s           | Any job fails OR any job succeeds                                     | Build-server matrices. Matrix slots run in parallel; one slot's outcome is enough to start reacting.  |
| `cool`    | 120s          | Whole run completes                                                   | After `release` reported a first success — just confirming the rest of the matrix. No fast polls.     |

The skill picks `fast` by default. After running `release` and getting a first success, the orchestrator (the agent invoking this skill) flips to `cool` for the remainder.

## How the skill drives the fix-and-push loop

`run.mts` is **eyes-only**: it watches a run, dumps the failure log tail to a tmp file, and prints a JSON verdict on its final line. The fix-and-push loop is driven by the calling agent. The full sequence:

1. Invoke `node .claude/skills/greening-ci/run.mts --repo <owner/name> [--workflow ci.yml] [--mode fast]`.
2. Parse the last line of stdout as JSON. Shape:
   ```json
   {
     "status": "completed" | "in_progress" | "queued" | "failure",
     "conclusion": "success" | "failure" | "cancelled" | "skipped" | null,
     "runId": 25932269958,
     "url": "https://github.com/<owner>/<repo>/actions/runs/<id>",
     "failedJobs": [{ "name": "Lint, Type, Validation", "logTailPath": "/tmp/greening-ci.../run-X-failed.log" }],
     "elapsedSec": 47
   }
   ```
3. Branch on `conclusion`:
   - `"success"` — done. Report and exit.
   - `"failure"` — read the log tail at `failedJobs[0].logTailPath`, classify the failure, fix locally in the target repo (which may be the current checkout or a worktree), commit + push, then re-invoke this skill to confirm green.
   - `null` (still running, but a job already failed) — same as `"failure"` for fix-and-push purposes. The whole run will be cancelled once main's protection kicks in; don't wait for it.
   - `"cancelled"` / `"skipped"` — report, ask the user; don't auto-fix.

## Failure-classification table

The log tail almost always ends in one of these patterns. The skill calls these out so the orchestrator can pattern-match before doing real analysis:

| Pattern in log tail                                                  | Likely root cause                                                              | Default fix                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `× @socketsecurity/lib not resolvable from /home/runner/work/...`    | Root `package.json` is missing the runtime dep the setup action requires.      | Add `"@socketsecurity/lib": "catalog:"` next to `lib-stable` in the root `package.json` + catalog entry.   |
| `Error: Cannot find module '...'` during a `node` step               | Missing dep / wrong import path / unbuilt artifact.                            | Trace the import to its package, add the dep, `pnpm install`, push.                                        |
| `pnpm: command not found` / `pnpm exec ...` exits 127                | `packageManager` mismatch / corepack disabled.                                 | Confirm `packageManager` in root `package.json` matches the workflow's expected pnpm.                      |
| `npm ERR! 401`/`403` reaching `registry.npmjs.org`                   | Stale `NPM_TOKEN` secret, scoped-package permission drift, or registry filter. | Surface to user — token rotation is out of scope for an auto-fix.                                          |
| `error: process "/bin/sh -c ..." did not complete successfully`      | Docker build step crashed — read the inner `RUN` for the real error.           | Read the Docker context for what `RUN` produced the exit code; fix that.                                   |
| `Failed to restore from cache` followed by `Process completed with exit code 1` | Cache miss + the build doesn't degrade — it errors.                            | Bump the `cache-versions.json` entry to invalidate, OR fix the degraded-mode code path.                    |
| `denied by enterprise admin` / `not allowed to be used`              | GH Actions allowlist missing an action. See `auditing-gha-settings`.           | Add the action to the org allowlist. The repo can't fix this — escalate.                                   |

When the pattern isn't in the table, fall back to careful read-through of the log tail. Don't guess.

## Wall-clock budgets

Every invocation carries a `--budget-sec` (default 1800 = 30 min) so a stuck run doesn't park the loop forever. When the budget expires, the skill emits its last snapshot and exits — the orchestrator can re-invoke with a longer budget if the run is legitimately slow (build-server matrices routinely take 30-60min).

Budget tiers:

- `fast` ci.yml watching: **30 min** is plenty. If ci.yml hasn't finished in 30min, something's wrong upstream (runner queue depth, broken cache step).
- `release` build matrix: **60 min**. Most build-server matrices finish in 20–45min; 60min covers the worst case.
- `cool` confirmation: **30 min** is fine — at this point you've already seen one success, you just want the rest.

## Companion: `auditing-gha-settings`

Some CI failures aren't code — they're GitHub Actions policy. If you see `denied by enterprise admin` or `the action <name> is not allowed to be used`, that's a GH org-level setting drift, not a code fix. Run `/audit-gha-settings <owner/repo>` (when available) to diff the repo's policy + allowlist against the fleet baseline. The current baseline must include:

- Policy: **Allow enterprise, and select non-enterprise, actions and reusable workflows**
- Allowlist (each must be present and active):
  - `actions/cache/restore@*`
  - `actions/cache/save@*`
  - `actions/cache@*`
  - `actions/checkout@*`
  - `actions/download-artifact@*`
  - `actions/setup-node@*`
  - `actions/setup-python@*`
  - `actions/upload-artifact@*`
  - `depot/build-push-action@*`
  - `depot/setup-action@*`
  - `dtolnay/rust-toolchain@*`
  - `github/codeql-action/upload-sarif@*`
  - `hendrikmuhs/ccache-action@*`
  - `mlugg/setup-zig@*`
  - `swatinem/rust-cache@*`

Each entry is here because at least one fleet workflow references it through the socket-registry shared workflows. Removing one breaks every consumer that pins through those shared workflows. Add a new entry only when a new shared workflow references it, and cascade the allowlist entry to every consumer org.

## Anti-patterns

- **Auto-merging from a worktree without confirming the target main is current.** Always `git fetch origin main` before pushing the fix — the fleet has heavy commit traffic.
- **Treating a `cancelled` run as a failure.** Someone (or branch protection) cancelled it. Re-run if needed; don't apply a code fix.
- **Polling faster than 30s.** GH's rate limit is generous but not infinite. The `run.mts` runner enforces 30s minimum.
- **Ignoring matrix slot interdependencies.** If `lief-darwin-arm64` fails because `lief-darwin-x64` produced a bad cache, fixing the arm64 slot won't help. Read both slots' logs before fixing.

## Examples

Watch a freshly-pushed CI run on main:

    /green-ci socket-btm ci.yml

Watch a build-server matrix dispatched a minute ago:

    /green-ci socket-btm build-curl.yml --mode release

Watch the rest of a matrix after the first slot succeeded:

    /green-ci socket-btm build-curl.yml --mode cool
