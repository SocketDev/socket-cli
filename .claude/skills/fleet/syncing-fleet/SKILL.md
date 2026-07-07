---
name: syncing-fleet
description: Sync a NAMED slice of the wheelhouse cascade — call out a target (pnpm-workspace, lint-config, foundationals, …) and sync just that, at one of three scopes (dogfood self, the whole fleet, or one member repo). The thin vocabulary layer over the cascade engine; full sync logic lives in scripts/fleet/sync.mts. Use when you want to cascade ONE concern instead of the full template, or to push a one-repo override.
user-invocable: true
allowed-tools: Bash(node:*), Bash(git:*), Read
model: claude-haiku-4-5
context: fork
---

# syncing-fleet

`git is more powerful than "pnpm-workspace.yaml only cascaded"`: name a slice and sync it. The dispatcher resolves the named target to its cascade finding-category set, runs the engine's checks, and fixes only those categories — at the scope you pick.

## Run it

```bash
node scripts/fleet/sync.mts <target…> [--dogfood | --fleet | --target <repo>] [--check]
```

- `--dogfood` — template/base → the wheelhouse's own live tree (self-sync; the default).
- `--fleet` — every fleet-repos.json member.
- `--target <repo>` — one member, by name or path (e.g. a `socket-registry` override).
- `--check` — dry-run; report would-change counts, write nothing.

## Targets

- **Leaves**: `pnpm-workspace`, `claude-md`, `git-meta`, `lint-config`, `editor-config`, `installer`, `fleet-code`, `package-baseline`, `registry-workflows` (fleet/repo only).
- **Composites**: `foundationals` (workspace + package-baseline + lint + editor + claude-md + git-meta), `dogfood` (installer + foundationals), `all` (every target).

## Vocabulary

"cascade `<target>`" = sync one scope by name · "dogfood `<target>`" = wheelhouse self-sync · "cascade `<target>` to `<repo>`" = sync one member.

The registry of targets + their category sets lives in `scripts/fleet/constants/sync-targets.mts` (load-time-validated); the dispatcher in `scripts/fleet/sync.mts` owns no sync logic of its own — it drives the cascade engine. For a full-template cascade across the fleet, use `cascading-fleet` instead.
