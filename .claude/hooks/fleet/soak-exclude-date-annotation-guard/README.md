# soak-exclude-date-annotation-guard

A **Claude Code PreToolUse hook** that blocks Edit/Write tool calls
which would land a per-package `minimumReleaseAgeExclude` entry in
`pnpm-workspace.yaml` without the canonical
`# published: YYYY-MM-DD | removable: YYYY-MM-DD` annotation directly
above the bullet.

## Why this rule

Soak-bypass entries are temporary by design — they exist because a
fresh release was needed faster than the 7-day soak window allows.
Without a documented removable-on date, entries accumulate and
nobody knows when they can safely be removed. The standard
annotation lets a periodic sweep (`grep -E 'removable: 2026-04'
pnpm-workspace.yaml`) find candidates whose natural soak has long
since cleared.

## Conventional shape

```yaml
minimumReleaseAgeExclude:
  # vite 8.0.13 ships rolldown natively (no esbuild transitive). ...
  # published: 2026-05-14 | removable: 2026-05-21
  - 'vite@8.0.13'
```

The annotation must be the **last comment line** above the bullet —
contiguous, no blank line between them. `published` is the version's
npm publish date (`npm view pkg@1.2.3 time` → look up the version-row
date). `removable` is `published + 7d`, the natural soak-clear date.

## What's enforced

- Every `  - 'pkg@1.2.3'` bullet inside the `minimumReleaseAgeExclude:`
  block must be preceded by a comment line matching:
  ```
  # published: YYYY-MM-DD | removable: YYYY-MM-DD
  ```
- The annotation must be the **immediately-preceding** line (last
  `#` line above the bullet).

## What's exempt

- **Scope-glob entries** (`'@socketsecurity/*'`, `'@socketregistry/*'`,
  etc.) — persistent fleet policy, not a time-bound bypass.
- **Bare-name entries** without `@version` (also persistent).
- Lines marked `# socket-hook: allow soak-exclude-no-date-annotation`.

## Override marker

For a legitimate one-off where the annotation truly doesn't apply:

```yaml
- 'pkg@1.2.3' # socket-hook: allow soak-exclude-no-date-annotation
```

Don't reach for this — add the annotation instead.

## Bypass phrase

If the user genuinely needs to bypass the whole hook for one session,
they must type `Allow soak-exclude-no-date-annotation bypass` verbatim
in a recent user turn.

## Wiring

In `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/fleet/soak-exclude-date-annotation-guard/index.mts"
          }
        ]
      }
    ]
  }
}
```

## Cross-fleet sync

This hook lives in `socket-wheelhouse/template/.claude/hooks/soak-exclude-date-annotation-guard`
and is required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.
