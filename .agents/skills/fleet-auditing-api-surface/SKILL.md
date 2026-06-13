---
name: fleet-auditing-api-surface
description: Audits a lib's published export surface for dead/unconsumed subpaths. For each `package.json#exports` subpath, checks whether any other fleet repo imports it and whether the lib's own `src/` references it, then classifies every subpath (dead / single-consumer / internal-only / consumed) into a ranked report. Read-only — reports prune candidates, never deletes. Use weekly (the `audit-api-surface.yml` cron drives it), before a major version bump, or when trimming bundle size on an infra lib.
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash(node:*), Bash(rg:*), Bash(git:*), Bash(gh:*)
model: claude-haiku-4-5
context: fork
---

# auditing-api-surface

Find published API that nobody uses. A core infra lib like `@socketsecurity/lib`
exports 500+ subpaths; some are referenced by no other fleet repo and not even
by the lib's own internals. That dead surface is pure carrying cost — bundle
weight, a wider type-check graph, a tax on every refactor. This skill surfaces
it. Read-only: it reports prune candidates, it never removes an export (mirrors
`auditing-gha`, which reports drift but flips no setting).

Repo-generic: it reads the host repo's own `package.json` name + export map, so
the same skill audits any lib-shaped fleet repo. socket-lib is the primary
target; other libs get a meaningful report too.

## When to use

- **Weekly health check** — the `audit-api-surface.yml` cron runs this and opens
  a tracking issue. Dead surface accumulates silently; a weekly sweep keeps it
  visible.
- **Before a major version bump** — a `dead` or `single-consumer` export is a
  candidate to remove (major) or inline into its one consumer.
- **Bundle trimming** — pairs with `trimming-bundle`; an unconsumed subpath is
  weight no downstream needs.

## What it does NOT do

- **Delete anything.** Every finding is a candidate for a human. A `dead` row
  may be a deliberate public entry point a not-yet-released consumer will use.
- **Prove a `dead` export is safe to remove.** The scan sees only the fleet
  repos present under `$PROJECTS` (CI clones the full roster first). A repo on
  the roster but absent locally is reported `unscanned`, and any subpath with an
  unscanned repo is classed `unverifiable` — never silently "dead".
- **Go to symbol granularity.** Classification is per-subpath (per exported
  file), not per named export. A subpath with one live symbol and ten dead ones
  reads as `consumed`. Symbol-level analysis is a future pass.

## How it classifies

| Class | Meaning | Action |
| --- | --- | --- |
| `dead` | no internal refs, no external consumers, all repos scanned | prune candidate |
| `single-consumer` | exactly one external consumer | candidate to inline there |
| `internal-only` | used inside the lib, by no other repo | keep (flagged for awareness) |
| `consumed` | ≥2 external consumers | healthy, keep |
| `unverifiable` | no consumer found, but a roster repo was unscanned | re-run with that repo cloned |

Both import forms are matched: `<pkg>/<subpath>` and the `-stable` alias
`<pkg>-stable/<subpath>` (every consumer aliases the lib both ways in
`pnpm-workspace.yaml`).

## Run

From the repo being audited:

```bash
node .claude/skills/fleet/auditing-api-surface/lib/audit-api-surface.mts --report
```

Or target a sibling checkout by name (greps the others as consumers):

```bash
PROJECTS=~/projects \
  node .claude/skills/fleet/auditing-api-surface/lib/audit-api-surface.mts \
  --repo socket-lib --report
```

`--report` (default) writes `.claude/reports/api-surface-audit.md` (untracked,
per the report-location rule). `--json` prints the machine-readable result to
stdout — the cron workflow consumes this to build its issue body.

## Verify before trusting

The report header states the scanned-repo count and the exact import forms
matched. The internal-ref counter is a loose basename match (it errs toward
keeping an export, never toward calling a live one dead). Before acting on a
`dead` finding, confirm by hand:

```bash
rg '@socketsecurity/<pkg>(-stable)?/<subpath>' ~/projects/socket-* --glob '!**/node_modules/**'
```

A finding is a lead, not a verdict.
