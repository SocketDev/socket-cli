# soak-pin-needs-annotation-guard

PreToolUse Edit/Write hook that blocks adding a version-pinned soak-exclude
entry to `scripts/repo/sync-scaffolding/manifest/workspace.mts` without a
matching `{ published, removable }` annotation in `release-age-annotations.mts`.

## Why

`EXPECTED_RELEASE_AGE_EXCLUDE` enforces pin ↔ annotation parity at MODULE LOAD
(it throws). Without this guard, a missing annotation surfaces only when the
cascade crashes mid-run — a confusing, late failure. This front-runs it: the
moment you add `'pkg@1.2.3'` to the soak list, the guard checks the annotations
registry and, if the date annotation is missing, blocks with the exact line to
add. No bypass — the fix is deterministic.

## Fix

Add to `scripts/repo/sync-scaffolding/manifest/release-age-annotations.mts`:

```ts
'pkg@1.2.3': { published: '<YYYY-MM-DD>', removable: '<published + 7d>' },
```

then re-add the pin.
