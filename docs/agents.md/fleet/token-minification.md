# Token minification

Wire-level token minification losslessly compresses Claude Code `tool_result`
payloads before they reach the model — cutting token cost without changing
semantics: the model sees the same information, fewer tokens.

## headroom-ai

A telemetry-locked wire-level proxy (a 3rd-party tool pinned in
`external-tools.json`, run via `uv`) that sits between Claude Code and the API
and compresses traffic. Started by `.claude/hooks/fleet/headroom-proxy-start/`
at SessionStart, which also sets `ANTHROPIC_BASE_URL` to the local proxy. Held
telemetry-OFF and fail-closed; the sfw CDN allowlist is the runtime backstop.
(Replaced the former in-repo `@socketsecurity/token-minifier`.)

It is the sole compression layer. The proxy compresses the whole request
payload (built-in and MCP tool_result blocks alike), so no per-tool hook is
needed. It is lossless, on by default, and does not change tool behavior.
