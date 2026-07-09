# no-new-config-guard

PreToolUse guard. Blocks creating a **new** standalone config-DATA file
(`.json` / `.yaml` / `.yml` / `.toml`) under a `.config/` directory.

Per-repo config flows through the ONE per-member settings file —
`.config/socket-wheelhouse.json` (the "wheelhouse settings", schema
`scripts/fleet/socket-wheelhouse-schema.mts`) — as a section that each script
reads via the schema. New single-purpose config files fragment config, drift,
and blur the fleet/repo tier.

- Only **creation** is blocked; editing an existing config is fine.
- Only config **data** (`.json`/`.yaml`/`.yml`/`.toml`); tooling code configs
  (`*.config.mts`, vitest/oxlint sources) are exempt.
- The wheelhouse settings + its schema are allowlisted.
- Bypass: `Allow new-config bypass` (a genuinely-needed new fleet-wide config).
