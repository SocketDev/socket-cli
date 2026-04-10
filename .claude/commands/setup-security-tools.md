Set up security scanning tools (AgentShield + zizmor) for this project.

## What this does

Installs and configures two security tools used by the pre-push hook and the `/security-scan` command:

1. **AgentShield** (`ecc-agentshield`) - Scans Claude AI configuration files (`.claude/`, `CLAUDE.md`) for prompt injection attacks and security misconfigurations. Already a devDep, so this just verifies it is installed.

2. **zizmor** - Static analysis tool for GitHub Actions workflows. Detects insecure patterns like template injection, unpinned actions, and excessive permissions. Downloaded from GitHub releases and cached at `~/.socket/zizmor/bin/zizmor`.

## Setup

Run the setup script:

```bash
node .claude/hooks/setup-security-tools/index.mts
```

This will:
1. Check if `agentshield` is available (installed via `pnpm install`)
2. Check if `zizmor` is already installed (via brew or cached)
3. If not cached, download the correct zizmor binary for the current OS/arch
4. Verify the SHA-256 checksum of the download
5. Extract and install to `~/.socket/zizmor/bin/zizmor`

## After setup

Both tools are used automatically by the pre-push hook (`.git-hooks/pre-push`):
- AgentShield failures **block** the push (it scans our own config)
- zizmor issues are **warnings only** (workflows may have known suppressions)

You can also run them manually:
```bash
pnpm exec agentshield scan          # Scan Claude config
~/.socket/zizmor/bin/zizmor .github/ # Scan GitHub Actions workflows
```

## Notes

- Safe to re-run — skips download if zizmor is already cached at the correct version
- If zizmor is installed via brew, the download is skipped entirely
- The pre-push hook checks for both tools and skips gracefully if not available
