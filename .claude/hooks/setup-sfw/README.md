# setup-sfw Hook

Sets up [Socket Firewall (SFW)](https://socket.dev) on your local machine so that package manager commands (`npm install`, `pnpm add`, `cargo build`, etc.) are automatically scanned for malware before packages are installed.

## What is Socket Firewall?

Socket Firewall sits between you and the package registry. When you run `npm install`, the firewall intercepts the request, checks the package against Socket.dev's malware database, and blocks it if it's malicious. You don't have to change how you work — it's transparent.

## How to use

Run the Claude Code command:

```
/setup-sfw
```

Claude will:
1. Ask if you have a Socket API key (for enterprise features)
2. Download the correct SFW binary for your OS
3. Verify the download's SHA-256 checksum
4. Create small wrapper scripts ("shims") for your package managers
5. Tell you how to activate it

## Free vs Enterprise

| | Free | Enterprise |
|---|------|-----------|
| **Cost** | Free | Requires API key |
| **npm/yarn/pnpm** | Yes | Yes |
| **pip/uv** | Yes | Yes |
| **cargo** | Yes | Yes |
| **gem/bundler** | No | Yes |
| **nuget** | No | Yes |
| **go** | No | Yes (Linux) |

If you have an API key, the setup stores it in `.env.local` (which is gitignored — never committed).

## How it works under the hood

```
You run: npm install express
            │
            ▼
    Shim intercepts the command
    (~/.socket/sfw/shims/npm)
            │
            ▼
    Shim calls SFW binary with
    the real npm path + your args
            │
            ▼
    SFW checks packages against
    Socket.dev's malware database
            │
            ├── Clean → npm install proceeds normally
            └── Malware → blocked, you see a warning
```

The shims are tiny bash scripts that live in `~/.socket/sfw/shims/`. When the shim directory is at the front of your `PATH`, running `npm` actually runs the shim, which calls `sfw` with the real `npm` binary.

## What gets installed where

| What | Where | Purpose |
|------|-------|---------|
| SFW binary | `~/.socket/_dlx/<hash>/sfw` | The firewall binary itself |
| Shims | `~/.socket/sfw/shims/npm`, etc. | Wrapper scripts for each package manager |
| API key | `.env.local` (project root) | Enterprise API key (gitignored) |

Everything is shared across repos — download once, use everywhere.

## Re-running

Safe to run multiple times. The script:
- Skips the download if the binary is already cached and valid
- Only rewrites shims if the content has changed
- Won't duplicate your API key in `.env.local`

## Activating the firewall

After setup, add the shim directory to your PATH:

```bash
export PATH="$HOME/.socket/sfw/shims:$PATH"
```

To make it permanent, add that line to your shell profile (`~/.zshrc`, `~/.bashrc`, or `~/.profile`).

## Troubleshooting

**"SFW binary already cached"** — This is normal. The binary was downloaded on a previous run and the checksum still matches.

**"Unsupported platform"** — SFW supports macOS (Intel + Apple Silicon), Linux (x64 + ARM64), and Windows (x64). Other platforms aren't supported yet.

**Shim not intercepting commands** — Make sure the shim directory is at the *front* of your PATH (before the real npm/pnpm). Run `which npm` — it should point to `~/.socket/sfw/shims/npm`, not the real one.

**"Checksum mismatch"** — The downloaded binary doesn't match the expected hash. This could mean a corrupt download or an outdated checksum in the script. Try deleting `~/.socket/_dlx/` and re-running.

## Dependencies

This hook uses `@socketsecurity/lib` for the download and caching infrastructure. It's already a dependency of every Socket project. Install with:

```bash
cd .claude/hooks/setup-sfw
npm install
```

## Copying to another repo

This hook is self-contained. To add it to another Socket repo:

1. Copy `.claude/hooks/setup-sfw/` and `.claude/commands/setup-sfw.md`
2. Run `cd .claude/hooks/setup-sfw && npm install`
3. Make sure `.claude/hooks/` is not gitignored (add `!/.claude/hooks/` to `.gitignore`)
