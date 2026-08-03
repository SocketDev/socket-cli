# dogfood-cascade-nudge

Claude Code `Stop` hook that fires in socket-wheelhouse when the session edited a `template/` file but the dogfood copy is stale.

## Why

The wheelhouse dogfoods its own template: the root `.claude/`, `.config/fleet/`, `scripts/fleet/`, and the CLAUDE.md fleet block are git-tracked COPIES that the running session actually uses. An un-cascaded `template/` edit leaves the LIVE copy stale, so a new hook, rule, or CLAUDE.md change doesn't take effect here until cascaded.

This enforces the rule on real filesystem state, not turn narration: it lists the `template/<X>` files changed this session, compares each to its dogfood twin `./<X>`, and reminds you to cascade if any differ.

## What it catches

- A changed `template/` file whose dogfood twin differs (byte-compare).
- A new `template/` file with no twin yet.
- CLAUDE.md: compared by its fleet block only (the `<fleet-canonical>` markers); the preamble and project-specific postamble are repo-owned and not mirrored.

## When it's a no-op

- In a cascaded fleet repo (no `template/` dir).
- When no `template/` files changed this session, or all twins match.

## The fix it points to

```sh
node scripts/repo/sync-scaffolding/cli.mts --target . --fix
```

Then commit the `template/` source — the cascade commits the dogfood copy.

## Test

```sh
pnpm test
```
