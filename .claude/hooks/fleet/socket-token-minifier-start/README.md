# socket-token-minifier-start

**Claude Code SessionStart hook.** Auto-starts the socket-token-minifier
proxy if installed and not already running. Writes
`export ANTHROPIC_BASE_URL=http://localhost:7779` to `$CLAUDE_ENV_FILE`
**only** if the proxy is verified healthy.

## Why fail-closed matters

Setting `ANTHROPIC_BASE_URL` unconditionally (via `template/.claude/settings.json:env`)
would break every session whose proxy is down — including CI runners that
weekly-update workflows invoke `claude` from. This hook gates the env-var
write on a live `/health` probe, so the worst-case path is "no compression,
direct to api.anthropic.com" — never a 502.

## Flow

1. **Probe** `localhost:7779/health` (250ms timeout).
2. If **healthy**: write env var, exit 0.
3. If **port returned a non-2xx status**: something else is listening; skip
   (don't clobber an unrelated process on this port).
4. If **binary not installed**: emit context, exit 0 without env-var write.
5. If **connection refused**: spawn the proxy detached, poll /health every
   100ms up to 2.5s total. If healthy in time, write env var. Else
   fail-closed (no env var).

Total time budget: ~3s worst case, ~0ms when proxy already healthy.

## Install dependency

This hook is a no-op until the proxy binary exists at
`~/.socket/_wheelhouse/bin/socket-token-minifier`. Install it via
`pnpm run install-token-minifier` from any fleet repo. The install script
sets up a self-contained pnpm workspace at
`~/.socket/_wheelhouse/socket-token-minifier/` and writes the bin shim.

## Wiring (template settings.json)

Inserted under `hooks.SessionStart`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/fleet/socket-token-minifier-start/index.mts",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

5-second timeout — generous enough for the 3s startup budget plus a buffer.

## Cross-fleet sync

This hook lives in `socket-wheelhouse/template/.claude/hooks/` and is
required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.
