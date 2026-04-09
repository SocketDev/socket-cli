Set up Socket Firewall (SFW) locally for this project.

## What this does

Downloads the SFW binary (with SHA-256 verification), creates PATH shims for
package managers (npm, pnpm, yarn, pip, etc.), so all installs are scanned
for malware automatically.

## Enterprise vs Free

SFW has two editions:
- **Free**: Scans npm, yarn, pnpm, pip, uv, cargo
- **Enterprise**: Adds gem, bundler, nuget, go — requires a `SOCKET_API_KEY`

## Setup

First, ask the user if they have a Socket API key for enterprise features.

If they do:
1. Ask them to provide it
2. Write it to `.env.local` as `SOCKET_API_KEY=<their-key>` (create file if needed)
3. Verify `.env.local` is in `.gitignore` — if not, add it and warn the user

If they don't, proceed with free mode.

Then run the setup script:
```bash
node .claude/hooks/setup-sfw/index.mts
```

After the script completes, add the shim directory to PATH for this session:
```bash
export PATH="$HOME/.socket/sfw/shims:$PATH"
```

## Notes

- Safe to re-run — skips download if binary is cached and valid
- Shims are shared across all repos at `~/.socket/sfw/shims/`
- The binary is cached at `~/.socket/_dlx/` with checksum verification
- `.env.local` is local-only and must NEVER be committed
