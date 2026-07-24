# Config segregation — no rogue configs, no loose back-compat

Per-repo config lives in ONE member-owned surface, and `.config/` holds only
segregated subtrees. Two rules, both guarded:

## 1. No new standalone config files → `socket-wheelhouse.json`

A new per-repo config-DATA file (`.json` / `.yaml` / `.yml` / `.toml`) under
`.config/` fragments config, drifts, and blurs the fleet/repo tier. Add a
**section** to the member settings file `.config/repo/socket-wheelhouse.json`
(schema `scripts/fleet/socket-wheelhouse-schema.mts`) and read it via the schema
instead. `no-new-config-guard` blocks creating a new `.config/*.{json,yaml,yml,toml}`
outside the allowlist, which permits only the settings file and its schema. Bypass:
`Allow new-config bypass` for a genuinely fleet-wide config with no home in the
settings.

Example: the lock-step comment-ref config was a standalone `lock-step-refs.json`;
it is now the `lockstep` section of `socket-wheelhouse.json`.

## 2. `.config/` is segregated — no loose files, no loose back-compat refs

Every `.config/` file lives under `.config/fleet/` (fleet-identical, cascaded)
or `.config/repo/` (repo-owned). Nothing sits loose at `.config/<file>`.

When a config is relocated to its segregated home, the move is **100%** — every
member migrates in the same wave, so there is no transient needing a fallback.
Do NOT add a legacy `.config/<file>` fallback path "for repos not yet migrated":
we migrate them all, then point every resolver at the one canonical location.
Back-compat cruft for a thing we are wholly changing is exactly the
"describe what code IS, not what it was" violation (`no-removal-comment-nudge`),
and it rots.

`no-loose-config-ref-guard` blocks source that constructs a loose
`.config/<file>.{json,yaml,yml,toml}` path (a string literal or a
`path.join(…, '.config', '<file>.json')` pair) — the segment after `.config`
must be `repo` or `fleet`. Bypass: `Allow loose-config-ref bypass`.

## Why

One member-owned config surface + a segregated `.config/` means a reader always
knows where a repo's config is, the fleet/repo tier is unambiguous, and a
migrated path has exactly one home — no drift, no rogue files, no dead fallback
branches to reason about.
