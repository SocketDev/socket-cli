---
name: fleet-tidying-rolldown-bundles
description: Keeps rolldown-bundled fleet repos lean — reports (and with --fix, runs `pnpm dedupe` for) collapsible lockfile transitives, checks that Socket-published packages route through the `catalog:` overrides, and flags any `external/` re-export shim that has grown into a fat re-vendored tree. Conservative and no-prompt: the only mutation is a lockfile-only `pnpm dedupe`; anything that would change the published bundle is reported for a human. Use for periodic dependency hygiene on bundle repos, or before a release.
user-invocable: true
allowed-tools: Bash(node:*), Bash(pnpm dedupe:*), Bash(pnpm run build:*), Read
model: claude-haiku-4-5
context: fork
---

# tidying-rolldown-bundles

The fleet's rolldown bundle repos (socket-lib's `external/` surface today) accrete
two kinds of dependency drift: lockfile transitives that pnpm can collapse, and the
slow risk that an `external/<dep>.js` re-export shim stops delegating to a shared
`*-pack` bundle and starts re-vendoring its own tree. This skill is the conservative,
no-prompt sweep that keeps both in check — the `tidying-*` family member for bundles.

## When to use

- **Periodic dependency hygiene** on bundle repos (run on a `/loop`).
- **Before a release** — confirm the lockfile is deduped and the bundle stays lean.
- **After a dependency bump** that may have introduced duplicate transitives.

## Run it

```bash
# Dry-run (default): report dedupe opportunities + override drift + fat shims.
node .claude/skills/fleet/tidying-rolldown-bundles/lib/tidy-rolldown-bundles.mts

# Act: also run `pnpm dedupe` for the repos with collapsible transitives.
node .claude/skills/fleet/tidying-rolldown-bundles/lib/tidy-rolldown-bundles.mts --fix

# One repo.
node .claude/skills/fleet/tidying-rolldown-bundles/lib/tidy-rolldown-bundles.mts --repo socket-lib
```

Reads the canonical roster from `cascading-fleet/lib/fleet-repos.txt`; resolves repos
under `$PROJECTS` (default `~/projects`). Repos without an `external/` dir or a
`scripts/bundle.mts` are skipped.

## Periodic, no-prompt operation

```
/loop 12h /fleet:tidying-rolldown-bundles --fix
```

The conservative contract makes an unattended `--fix` safe: its only mutation is
`pnpm dedupe`, whose effect is lockfile-only — the published artifact is unchanged.

## What it checks

1. **Dedupe-available** — `pnpm dedupe --check` reports collapsible transitives.
   Under `--fix`, runs `pnpm dedupe` (lockfile-only). **Re-run the bundle build after**
   to confirm the externals still load.
2. **Override-missing** — a Socket-published prefix (`@socketsecurity/*`,
   `@socketregistry/*`) is referenced but not routed through a `catalog:` override, so
   it can float to a duplicate version. Reported (not auto-fixed — the override block is
   fleet-canonical, sync-managed).
3. **Fat shim** — an `external/<dep>.js` exceeds the re-export-shim size cap, meaning it
   likely re-vendors its own tree instead of delegating to a shared `*-pack` bundle
   (the `*-pack.js` consolidation bundles are exempt). Reported for a human.

## Why external/ rarely needs hand-deduping

The fleet's `external/` bundles already dedupe by design: shared deps are consolidated
into mega-bundles (socket-lib's `npm-pack` / `external-pack`), and the per-dep files are
thin re-export shims — `module.exports = require('./npm-pack').semver`. So a shared dep
like `semver` exists once, not once per consumer. This sweep's job is to keep it that way
(catch a shim that regresses to fat) and to collapse the lockfile transitives that
accumulate around the bundle, not to re-architect the consolidation.

## Conservative contract

- **Never edits source, never removes a dependency, never rewrites the bundle.**
- The only mutation is `pnpm dedupe` (lockfile-only); override + fat-shim findings are
  reported for a human to act on.
- Dry-run by default; `--fix` opts into the dedupe.
- After any `--fix` dedupe, the operator (or the skill's caller) rebuilds the affected
  bundle to confirm the externals still load — a dedupe shifts resolved versions.
