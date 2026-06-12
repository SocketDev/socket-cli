# no-other-linters-guard

A **Claude Code PreToolUse hook** enforcing the fleet rule: **oxlint + oxfmt
only**. No ESLint, Prettier, Biome, dprint, or rome.

## Why

The fleet standardized on oxlint (lint) + oxfmt (format). A stray ESLint /
Prettier / Biome config or dependency means two competing toolchains: divergent
style (e.g. Biome's double-quotes/tabs vs oxfmt's single-quotes/spaces), a second
lint config to keep in sync, and CI gates that check the wrong formatter. One
toolchain, enforced.

## What's blocked (edit-time)

1. **Foreign config files** — creating/editing a `biome.json(c)`, `.eslintrc*`,
   `eslint.config.*`, `.prettierrc*`, `prettier.config.*`, or `.dprint.json*`.
2. **Foreign packages in `package.json`** — adding `@biomejs/biome`, `eslint`,
   `@eslint/*`, `@typescript-eslint/*`, `prettier`, `dprint`, `rome`, or the
   `eslint-config-*` / `eslint-plugin-*` / `prettier-plugin-*` / `@<scope>/eslint-*`
   families to any dependency block.

## What's exempt

**Vendored upstream trees** — any path under `upstream/`, `vendor/`,
`third_party/`, `external/`, or a package dir ending `-upstream`. We never touch
upstream files, and upstream ships its own tooling (out of fleet-tooling scope).

## Defense in depth

This guard is the **edit-time block**. It complements:
- `socket/no-eslint-biome-config-ref` — **reports** stale string refs to legacy
  tools in TS/JS source (lint rule).
- `scripts/fleet/check/only-oxlint-oxfmt.mts` — gates **committed state** (a hard
  gate in `check --all`).

## Fix

Use the fleet tooling: lint via the oxlint plugin + `.config/fleet/oxlintrc.json`,
format via `.config/fleet/oxfmtrc.json`. Point package scripts at
`oxlint -c .config/fleet/oxlintrc.json` / `oxfmt -c .config/fleet/oxfmtrc.json`.

## Bypass phrase

For a genuine one-off (rare), type `Allow other-linter bypass` verbatim in a
recent user turn, then retry.

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
            "command": "node .claude/hooks/fleet/no-other-linters-guard/index.mts"
          }
        ]
      }
    ]
  }
}
```

## Cross-fleet sync

Lives in `socket-wheelhouse/template/.claude/hooks/no-other-linters-guard` and is
byte-identical across every fleet repo. `scripts/sync-scaffolding.mts` flags
drift; `--fix` rewrites it.
