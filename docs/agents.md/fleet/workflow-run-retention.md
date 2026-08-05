# Actions storage retention

Two kinds of Actions storage grow without bound and are swept by one weekly
workflow: **run history** and **cache**.

GitHub keeps every Actions run forever by default. Across the fleet that grows
into thousands of stale runs per repo — slow run lists, noisy API pagination,
and run groups for workflows that no longer exist. A scheduled prune keeps the
history bounded.

Cache is the sharper problem, because going over budget produces no error at
all. See [Cache retention](#cache-retention) below.

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

Auth: the `gh` CLI (`GITHUB_TOKEN` in CI, the OS keychain locally). Removing
runs needs the `actions: write` permission.

Prune through this script, never a hand-rolled API loop or a manual sweep over
individual runs. A hand loop skips the classification rules above and has no
rate-limit backoff. Preview with `--dry-run` first.

## Cache retention

GitHub caps Actions cache at **10 GB per repo** and, past the cap, silently
evicts least-recently-used entries. Nothing fails. The only symptom is that jobs
get slow again, because the entries the repo restores most often are exactly the
ones large enough to be evicted first, so the repo pays a cold rebuild on every
run while reporting green. This is not hypothetical: ultrathink sat at 10.67 GB
across 43 entries and was continuously evicting itself.

`scripts/fleet/prune-actions-caches.mts` keeps a repo clear of that cap in two
passes:

<details>
<summary><b>Detail</b> — `node scripts/fleet/prune-actions-caches.mts`</summary>

- **Per-group retention** — entries are grouped by key prefix (the cache key
  minus its trailing `hashFiles()` digest, so `Linux-cargo-a1b2c3d4` and
  `Linux-cargo-f6e5d4c3` are two generations of one logical cache). Keep the
  newest `--keep N` per group (default 2); the generations behind them can never
  be restored again and are pure dead weight. A key whose final segment is a
  version or a platform rather than a digest keeps that segment and stays its
  own group, so `pnpm-store-v1-macOS-node26` never evicts
  `pnpm-store-v1-Linux-node26`.
- **Budget enforcement** — if the survivors still exceed `--max-bytes` (default
  8 GB, deliberate headroom under the 10 GB ceiling because caches are written
  continuously while the sweep runs weekly), evict the least-recently-accessed
  of them until they fit.

**Freshness is the floor.** The budget pass never touches an entry accessed
within `--fresh-days` (default 7), measured back from the newest access in the
inventory rather than wall-clock now. That keeps the decision reproducible and
still identifies a live set on a dormant repo. When the fresh set alone is over
budget, the script exits non-zero saying so instead of evicting a hot cache: at
that point pruning cannot help and the workflows need to cache less.

```bash
# Report only — never deletes:
node scripts/fleet/prune-actions-caches.mts --dry-run

# Default policy (keep 2 per group, 8 GB budget, 7-day freshness floor):
node scripts/fleet/prune-actions-caches.mts

# Sweep the fleet, or target one repo with a tighter budget:
node scripts/fleet/prune-actions-caches.mts --all
node scripts/fleet/prune-actions-caches.mts --repo owner/name --max-bytes 4gb
```

</details>

## Scheduled caller

`.github/workflows/prune-workflow-runs.yml` runs both sweeps weekly (Sundays
04:00 UTC) and on `workflow_dispatch` (with `days` / `dry-run` inputs). They are
two steps of one job rather than two jobs: a second job would start on a bare
runner and need its own copy of the inline git-fetch bootstrap, which is
deliberately tri-plicated and lock-step checked. The cache step carries
`if: always()`, so a failed run sweep still lets the cache sweep reclaim. The job
grants `actions: write` + `contents: read` and runs via the fleet
`setup-and-install` action. Both scripts and the workflow are cascaded
byte-identical across the fleet — edit the `template/base/` copies and
re-cascade.
