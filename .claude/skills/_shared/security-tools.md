# Security Tools

Shared tool detection for security scanning pipelines.

## AgentShield

Installed as a pinned devDependency (`ecc-agentshield` in pnpm-workspace.yaml catalog).
Run via: `pnpm exec agentshield scan`
No install step needed — available after `pnpm install`.

## Zizmor

Not an npm package. Installed via `pnpm run setup` which downloads the pinned version
from GitHub releases with SHA256 checksum verification (see `external-tools.json`).

The binary is cached at `.cache/external-tools/zizmor/{version}-{platform}/zizmor`.

Detection order:
1. `command -v zizmor` (if already on PATH, e.g. via brew)
2. `.cache/external-tools/zizmor/*/zizmor` (from `pnpm run setup`)

Run via the full path if not on PATH:
```bash
ZIZMOR="$(find .cache/external-tools/zizmor -name zizmor -type f 2>/dev/null | head -1)"
if [ -z "$ZIZMOR" ]; then ZIZMOR="$(command -v zizmor 2>/dev/null)"; fi
if [ -n "$ZIZMOR" ]; then "$ZIZMOR" .github/; else echo "zizmor not installed — run pnpm run setup"; fi
```

If not available:
- Warn: "zizmor not installed — run `pnpm run setup` to install"
- Skip the zizmor phase (don't fail the pipeline)

## Socket CLI

Optional. Used for dependency scanning in the updating and security-scan pipelines.

Detection: `command -v socket`

If not available:
- Skip socket-scan phases gracefully
- Note in report: "Socket CLI not available — dependency scan skipped"
