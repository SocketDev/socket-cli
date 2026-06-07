# synthesized-script-edit-reminder

PreToolUse reminder (Edit / Write / MultiEdit). Never blocks — exit 0 with a
stderr nudge.

## What it does

Root `package.json` `scripts` are SYNTHESIZED by the cascade from
`CANONICAL_SCRIPT_BODIES` in `scripts/repo/sync-scaffolding/manifest.mts`. A
hand-edit to one of those `scripts` entries in `package.json` is reverted by the
next `chore(wheelhouse): cascade …` — the manifest is the source of truth.

When an Edit/Write to a `package.json` touches a `scripts` key the manifest
synthesizes, this hook points you at the manifest:

```
node scripts/repo/sync-scaffolding/cli.mts --target . --fix
```

## Scope

Wheelhouse-only: the manifest ships only in the wheelhouse host repo. In a
cascaded fleet repo there is no manifest, so the hook is a silent no-op.

## Why

When a check rename leaves a `CANONICAL_SCRIPT_BODIES` entry pointing at a
deleted file, the fix has to land in the manifest — a direct `package.json` edit
silently reverts on the next cascade. The companion
`scripts/fleet/check/script-paths-resolve.mts` catches the resulting dangling
path at commit time; this reminder steers the edit to the right surface before
it happens.

## Bypass

No bypass — it's a reminder (exit 0), not a block.
