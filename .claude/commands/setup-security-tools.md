Set up all Socket security tools for local development.

## What this sets up

1. **AgentShield** — scans Claude config for prompt injection and secrets
2. **Zizmor** — static analysis for GitHub Actions workflows
3. **SFW (Socket Firewall)** — intercepts package manager commands to scan for malware

## Setup

First, ask the user if they have a Socket API key for SFW enterprise features.

If they do:
1. Ask them to provide it
2. Write it to `.env.local` as `SOCKET_API_KEY=<their-key>` (create if needed)
3. Verify `.env.local` is in `.gitignore` — if not, add it and warn

If they don't, proceed with SFW free mode.

Then run:
```bash
node .claude/hooks/setup-security-tools/index.mts
```

After the script completes, add the SFW shim directory to PATH:
```bash
export PATH="$HOME/.socket/sfw/shims:$PATH"
```

## Notes

- Safe to re-run (idempotent)
- AgentShield needs `pnpm install` (it's a devDep)
- Zizmor is cached at `~/.socket/zizmor/bin/`
- SFW binary is cached via dlx at `~/.socket/_dlx/`
- SFW shims are shared across repos at `~/.socket/sfw/shims/`
- `.env.local` must NEVER be committed
- `/update` will check for new versions of these tools via `node .claude/hooks/setup-security-tools/update.mts`
