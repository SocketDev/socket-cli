# oxlint-plugin-load-guard

**Trigger:** PostToolUse on `Edit` / `Write` touching `.config/fleet/oxlint-plugin/**`.

**What it does:** re-runs `scripts/fleet/check/oxlint-plugin-loads.mts` after the edit lands
and prints a loud warning if the socket/ oxlint plugin no longer loads or its registered
rule count stops matching the rule-file count.

**Why:** a broken import anywhere in the plugin (a bad transitive import, a syntax error in a
`lib/` helper, a renamed export) disables **every** `socket/` rule. oxlint only emits a
`Failed to load JS plugin` warning on stderr — gating varies by version — and never checks
the rule count, so a green lint can hide a fully-disabled plugin. This hook catches the
breakage in-session, the moment it's introduced, before it cascades out to the fleet.

**Blocking:** no — PostToolUse, reporting only (exit 0). The edit already landed; the hook
surfaces the problem rather than gating it. The commit-time gate
`scripts/fleet/check/oxlint-plugin-loads.mts` (run by `pnpm check` / pre-push) is the
fail-closed backstop.

**Bypass:** none needed (non-blocking). Skips silently when the plugin / check script is
absent (scaffolding-only repos).

Defense-in-depth pair: edit-time hook (this) + commit-time gate
(`check-oxlint-plugin-loads.mts`).
