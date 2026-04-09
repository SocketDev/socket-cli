Download and configure Socket Firewall (SFW) locally.

Detects enterprise vs free mode based on SOCKET_API_KEY, downloads the correct platform binary with SHA-256 verification, and creates PATH shims for supported package managers.

## Usage

Run this command to set up SFW on your local machine. Re-running is safe (idempotent).

## Steps

1. Run the setup script:
   ```bash
   node --import tsx /Users/jdalton/projects/socket-cli/.claude/hooks/setup-sfw/index.mts
   ```
2. Follow the PATH instructions printed at the end.
