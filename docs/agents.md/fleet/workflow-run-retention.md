# Workflow-run retention

GitHub keeps every Actions run forever by default. Across the fleet that grows
into thousands of stale runs per repo — slow run lists, noisy API pagination,
and run groups for workflows that no longer exist. A scheduled prune keeps the
history bounded.

## Policy

`scripts/fleet/prune-workflow-runs.mts` classifies every run group and prunes
accordingly:

- **Purged** — the workflow's path or display name matches a purge pattern
  (built-in: `dynamic/dependabot/`, `gh-audit-*`; extend per-invocation with
  `--purge <glob>`) → every run is removed, even when the source file is on
  the default branch.
- **Source absent** from the default branch (deleted workflow file, an
  org-managed dynamic workflow, or an orphaned run group whose `workflow_id`
  is no longer in `/actions/workflows`) → every run is removed.
- **Source present** on the default branch → keep the newest `--keep N` runs
  (default 20); with `--days N`, runs older than the window also go. When
  both flags are given the removals union.

It covers both registered workflows (`/actions/workflows`) and orphaned run
groups (runs whose `workflow_id` is absent from that list), and repeats the
prune cycle on a repository until a cycle finds nothing left, so API-capped
run listings still converge.

## Fail-loud reads

A wrong answer to "is this workflow's source on the default branch?" dooms
live runs, so every read aborts loud instead of guessing: a failed repo read
(no default branch), a failed workflow/run listing, or a non-404 contents
error (rate limit, network) marks the repo failed and exits non-zero — only
an explicit HTTP 404 counts as absent.

## Rate limits

Run deletes hit GitHub's **secondary** rate limit (separate from the primary
quota) — a tight delete loop gets 403-throttled and stalls. The script paces
each delete (`PACE_MS`) and, on a throttle response, backs off exponentially
(`INITIAL_BACKOFF_MS` → `MAX_BACKOFF_MS`) and retries the same run. In `--all`
mode a few repos are pruned concurrently (`CONCURRENCY`), all sharing the one
token's budget.

A **refused** delete (HTTP 409 — the run is still in progress) is retried
within the same sweep: a refusals-only round waits `REFUSED_RETRY_DELAY_MS`
for those runs to finish, then re-lists and retries — the wait doubles each
consecutive dry round (3m, 6m, …) — up to `REFUSED_RETRIES` such rounds
before leaving the remainder to the weekly cadence.

## Running it

```bash
# Report only — never deletes:
node scripts/fleet/prune-workflow-runs.mts --dry-run

# Keep only the newest 20 runs per live workflow (the default policy):
node scripts/fleet/prune-workflow-runs.mts

# Sweep the whole fleet roster (needs the cascaded fleet-repos.json):
node scripts/fleet/prune-workflow-runs.mts --all

# Target another repo, add a time window, purge an extra run group:
node scripts/fleet/prune-workflow-runs.mts --repo owner/name --days 30 --purge 'old-nightly-*'
```

Auth: the `gh` CLI (`GITHUB_TOKEN` in CI, the OS keychain locally). Deleting
runs needs the `actions: write` permission.

## Scheduled caller

`.github/workflows/prune-workflow-runs.yml` runs it weekly (Sundays 04:00 UTC)
and on `workflow_dispatch` (with `days` / `dry-run` inputs). The job grants
`actions: write` + `contents: read` and runs the script via the fleet
`setup-and-install` action. Both the script and the workflow are cascaded
byte-identical across the fleet — edit the `template/base/` copies and
re-cascade.
