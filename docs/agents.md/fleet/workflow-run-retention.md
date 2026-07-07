# Workflow-run retention

GitHub keeps every Actions run forever by default. Across the fleet that grows
into thousands of stale runs per repo — slow run lists, noisy API pagination,
and run groups for workflows that no longer exist. A scheduled prune keeps the
history bounded.

## Policy

`scripts/fleet/prune-workflow-runs.mts` deletes runs by a single validity
signal — **is the workflow's source `.yml` on the default branch?**

- **Source present** on the default branch → delete runs older than the
  retention window (`--days`, default 15); keep the rest.
- **Source absent** (deleted workflow file, an org-required workflow not
  vendored here, or an orphaned run group whose `workflow_id` is no longer in
  `/actions/workflows`) → delete **all** of its runs.

It covers both registered workflows (`/actions/workflows`) and orphaned run
groups (runs whose `workflow_id` is absent from that list).

## Rate limits

Run deletes hit GitHub's **secondary** rate limit (separate from the primary
quota) — a tight delete loop gets 403-throttled and stalls. The script paces
each delete (`PACE_MS`) and, on a throttle response, backs off exponentially
(`INITIAL_BACKOFF_MS` → `MAX_BACKOFF_MS`) and retries the same run.

## Running it

```bash
# Report only — never deletes:
node scripts/fleet/prune-workflow-runs.mts --dry-run

# Delete with a custom window:
node scripts/fleet/prune-workflow-runs.mts --days 30
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
