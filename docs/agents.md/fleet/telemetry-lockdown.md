# Telemetry / phone-home lockdown

Companion to the `### Supply-chain & network` rule in `template/CLAUDE.md`.
Policy: **we never silently phone home.** Every dependency and external tool is
held to telemetry-off, enforced fail-closed at two layers, re-checked on every
software update. The sfw CDN allowlist is the runtime backstop regardless.

## The two enforcement arms

1. **Dep-surface scanner** (`scripts/fleet/lib/telemetry-scan.mts`): name-based
   detection of known telemetry / analytics SDKs (Sentry, PostHog, Segment,
   Amplitude, Datadog, OpenTelemetry **SDK + exporters**, langfuse, Scarf,
   Bugsnag, Rollbar, …) across `pnpm-lock.yaml`, every `uv.lock`, and
   `external-tools.json` purls. Inert APIs that cannot export
   (`opentelemetry-api` with no exporter) are deliberately NOT flagged.
   - `REVIEWED_TELEMETRY` is the audited baseline. Any SDK **not** in it FAILS —
     so an SDK ADDED by a dep bump or a new tool is caught and forced through a
     human review + an explicit accept-with-reason.
   - Runs as a `check --all` gate (`check/telemetry-deps-are-reviewed.mts`) AND
     as a Pass-4 scan in `scripts/fleet/update.mts` (every `pnpm run update`
     re-checks the refreshed lockfile).
2. **Per-tool runtime lockdown**: a tool's OWN telemetry (not a third-party SDK,
   so invisible to the dep scanner) is forced off at the launch chokepoint. See
   headroom: its `bin/headroom` is a wrapper that exports
   `HEADROOM_TELEMETRY=off` + `HEADROOM_TELEMETRY_WARN=off` + `HF_HUB_OFFLINE=1`
   before exec (`setup-security-tools/lib/headroom.mts`), a load-time invariant
   throws if the lockdown is weakened (fail-closed import), and
   `check/headroom-is-telemetry-locked-down.mts` gates it. Audit:
   `.claude/reports/headroom-telemetry-audit.md`.

## Fleet no-phone-home env (`FLEET_ENV`)

A universal env set — `_shared/fleet-env.mts` — applied on EVERY surface to force
telemetry / update-notifier opt-outs fail-closed:

- `NO_UPDATE_NOTIFIER=1` — the npm + pnpm update-notifier registry check.
  Cross-platform, so it lives here, NOT the macOS-only auto-update list — that
  mis-scoping is why CI runners once lacked it and the auto-update gate failed
  in CI.
- `DO_NOT_TRACK=1` — the cross-tool opt-out standard (consoledonottrack.com).
  Honored today by the vendored Claude Code runtime in `@socketsecurity/lib`
  (`prim.cjs`); free forward-cover for any future tool that reads it.
- `DISABLE_TELEMETRY=1` — generic opt-out (Claude Code + several CLIs).
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` — Claude Code's master switch
  (telemetry + error reporting + autoupdater + non-essential model calls). Set
  for completeness even though Claude Code already honors `DO_NOT_TRACK`.

One source of truth, consumed three ways: `setup-security-tools` persists it into
the dev shell-rc, the reusable CI workflow sets it in `env:`, and `spawnAiAgent`
injects it into every spawned agent. `check/telemetry-env-is-disabled.mts`
asserts it fail-closed.

## Reviewing a finding (when the scan fails)

1. Read the SDK's code: default-on or opt-in? what endpoint? what payload? does
   it need a key/env to ship (most do — no key = inert)?
2. Neutralize, in order of preference: drop the dep / tool; `pnpm-workspace.yaml`
   `overrides:` to a stub; an env opt-out at the launch chokepoint; a per-tool
   lockdown wrapper (the headroom pattern).
3. Only if genuinely inert (no key configured, no default-on egress) AND covered
   by the sfw allowlist backstop: add it to `REVIEWED_TELEMETRY` with the exact
   reason it is tolerated. Re-review on every bump.

## Current reviewed baseline

None. No telemetry SDK is tolerated in the tree. `@rely-ai/caliber` (which
pulled in `posthog-node`) was removed — it bundled a hardcoded PostHog key as of
1.49.3 and was unused beyond a manual `score` command, so it was dropped rather
than kept behind `CALIBER_TELEMETRY_DISABLED`. Any telemetry SDK that reappears
fails `telemetry-scan` until reviewed.

## sfw backstop

Everything runs under Socket Firewall. The CDN allowlist must NOT include
telemetry hosts (supabase telemetry projects, `*.headroomlabs.ai`,
`cloud.langfuse.com`, posthog hosts, `huggingface.co` for model fetches); only
the LLM-provider host a proxy legitimately forwards to. So even a regressed env
var cannot leak — the firewall denies the egress.
