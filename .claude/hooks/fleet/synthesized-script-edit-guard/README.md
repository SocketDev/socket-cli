# synthesized-script-edit-guard

PreToolUse guard (Edit / Write / MultiEdit). **Blocks** (exit 2) with a stderr
explanation.

## What it does

Root `package.json` `scripts` are SYNTHESIZED by the cascade from
`CANONICAL_SCRIPT_BODIES` in `scripts/repo/sync-scaffolding/manifest.mts`. A
hand-edit to one of those `scripts` entries in `package.json` is reverted by the
next `chore(wheelhouse): cascade …` — the manifest is the source of truth, so
the edit is always wrong.

When an Edit/Write to a `package.json` touches a `scripts` key the manifest
synthesizes, this hook blocks the edit and points you at the manifest:

```
node scripts/repo/sync-scaffolding/cli.mts --target . --fix
```

## Scope

Wheelhouse-only: the manifest ships only in the wheelhouse host repo. In a
cascaded fleet repo there is no manifest, so the hook is a silent no-op.

## Why a guard, not a reminder

The companion `scripts/fleet/check/script-paths-resolve.mts` only catches a
*dangling path* at commit time, not the broader "you edited a synthesized
entry" mistake. There was no hard gate for that — a direct `package.json` edit
reverts on the next cascade silently. Since editing a synthesized entry is
always the wrong surface, the guard blocks at edit time rather than nudging.

## Bypass

Type `Allow synthesized-script-edit bypass` in a recent user turn — for the rare
case where a transient local edit is intended before the manifest catch-up.
