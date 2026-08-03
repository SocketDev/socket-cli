# headroom-proxy-start

**Claude Code SessionStart hook.** Auto-starts the **headroom-ai** AI
context-compression proxy if installed and not already running. Writes
`export ANTHROPIC_BASE_URL=http://localhost:7779` to `$CLAUDE_ENV_FILE`
**only** if the proxy is verified healthy. Fully replaces the removed
`socket-token-minifier-start`, reusing its :7779 port so the fleet-canonical
`ANTHROPIC_BASE_URL` is unchanged across the cutover.

**Port override:** set `HEADROOM_PROXY_PORT` to use a different port (default
7779); the probe, spawn, and `ANTHROPIC_BASE_URL` all derive from it.

## 🔒 Telemetry + model-fetch lockdown

The hook spawns `~/.socket/_wheelhouse/bin/headroom`, the **lockdown wrapper**
installed by setup-security-tools (`lib/headroom.mts`). The wrapper exports
`HEADROOM_TELEMETRY=off`, `HEADROOM_TELEMETRY_WARN=off`, and `HF_HUB_OFFLINE=1`
before exec, so headroom's default-on telemetry beacon and its HuggingFace model
fetch are off. `--no-telemetry` is passed too (belt). Enforced by
`scripts/fleet/check/headroom-is-telemetry-locked-down.mts`; audit in
`.claude/reports/headroom-telemetry-audit.md`. The sfw CDN allowlist is the
runtime backstop.

## Why fail-closed matters

Setting `ANTHROPIC_BASE_URL` unconditionally would break every session whose
proxy is down, including CI runners that weekly-update workflows invoke `claude`
from. This hook gates the env-var write on a live `/health` probe, so the
worst-case path is "no compression, direct to api.anthropic.com", never a 502.

## Flow

1. **Probe** `localhost:7779/health` (250ms timeout).
2. If **healthy**: write env var, exit 0.
3. If **port returned a non-2xx status**: try to **reap a wedged instance**.
   `reapWedgedProxy()` re-probes /health (bails if healthy, so a live shared
   proxy is never killed) and SIGKILLs only PIDs whose command identifies them
   as the `headroom` binary. If it reaps one, fall through to (5); if it reaps
   nothing, the port belongs to something unrelated, so skip.
4. If **binary not installed**: emit context, exit 0 without env-var write.
5. If **connection refused**: spawn `headroom proxy --port 7779 --no-telemetry`
   detached, poll /health every 100ms up to 2.5s. If healthy in time, write env
   var. Else fail-closed (no env var).

Total time budget: ~3s worst case, ~0ms when the proxy is already healthy.

## Install dependency

This hook is a no-op until the lockdown wrapper exists at
`~/.socket/_wheelhouse/bin/headroom`. Install it via
`pnpm run setup-security-tools` (runs `setupHeadroom`, which `uv sync --locked`s
the pinned `headroom-ai[proxy]` closure into the `_dlx/<hash>/` store and writes
the wrapper bin handle). Adoption + lockdown detail:
`docs/agents.md/fleet/telemetry-lockdown.md`.

## Wiring (template settings.json)

Inserted under `hooks.SessionStart`:

```json
{
  "type": "command",
  "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/fleet/headroom-proxy-start/index.mts"
}
```

## Cross-fleet sync

This hook lives in `socket-wheelhouse/template/.claude/hooks/` and is required to
be byte-identical across every fleet repo. The cascade flags drift; `--fix`
rewrites it.
