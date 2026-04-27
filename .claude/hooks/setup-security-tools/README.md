# setup-security-tools Hook

Sets up all three Socket security tools for local development in one command.

## Tools

### 1. AgentShield

Scans your Claude Code configuration (`.claude/` directory) for security issues like prompt injection, leaked secrets, and overly permissive tool permissions.

**How it's installed**: npm package downloaded via the dlx system (pinned version + integrity hash from `external-tools.json`), cached at `~/.socket/_dlx/`. Subsequent runs reuse the cache. No `devDependencies` entry required in the consumer repo.

### 2. Zizmor

Static analysis tool for GitHub Actions workflows. Catches unpinned actions, secret exposure, template injection, and permission issues.

**How it's installed**: Binary downloaded from [GitHub releases](https://github.com/zizmorcore/zizmor/releases), SHA-256 verified, cached via the dlx system at `~/.socket/_dlx/`. If you already have it via `brew install zizmor`, the download is skipped.

### 3. SFW (Socket Firewall)

Intercepts package manager commands (`npm install`, `pnpm add`, etc.) and scans packages against Socket.dev's malware database before installation.

**How it's installed**: Binary downloaded from GitHub, SHA-256 verified, cached via the dlx system at `~/.socket/_dlx/`. Small wrapper scripts ("shims") are created at `~/.socket/sfw/shims/` that transparently route commands through the firewall.

**Free vs Enterprise**: If you have a `SOCKET_API_KEY` (in env, `.env`, or `.env.local`), enterprise mode is used with additional ecosystem support (gem, bundler, nuget, go). Otherwise, free mode covers npm, yarn, pnpm, pip, pip3, uv, and cargo.

## How to use

```
/setup-security-tools
```

Claude will ask if you have an API key, then run the setup script.

## What gets installed where

| Tool        | Location                      | Persists across repos? |
| ----------- | ----------------------------- | ---------------------- |
| AgentShield | `~/.socket/_dlx/<hash>/agentshield` | Yes              |
| Zizmor      | `~/.socket/_dlx/<hash>/zizmor`      | Yes              |
| SFW binary  | `~/.socket/_dlx/<hash>/sfw`         | Yes              |
| SFW shims   | `~/.socket/sfw/shims/npm`, etc.     | Yes              |

## Pre-push integration

The `.git-hooks/pre-push` hook automatically runs:

- **AgentShield scan** (blocks push on failure)
- **Zizmor scan** (blocks push on failure)

This means every push is checked — you don't have to remember to run `/security-scan`.

## Re-running

Safe to run multiple times:

- AgentShield: skips download if cached binary matches the pinned version
- Zizmor: skips download if cached binary matches expected version
- SFW: skips download if cached, only rewrites shims if content changed

## Copying to another repo

Self-contained. To add to another Socket repo:

1. Copy `.claude/hooks/setup-security-tools/` and `.claude/commands/setup-security-tools.md`
2. Ensure the consumer repo has `@socketsecurity/lib`, `@socketregistry/packageurl-js`, and `@sinclair/typebox` available (via workspace catalog or direct deps)
3. Ensure `.claude/hooks/` is not gitignored (add `!/.claude/hooks/` to `.gitignore`)
4. Run `pnpm install` in the consumer repo so the hook's workspace deps resolve

## Troubleshooting

**"AgentShield install failed"** — Check network access to npm registry. The dlx system caches at `~/.socket/_dlx/`; clear the cache (`rm -rf ~/.socket/_dlx/`) to force a fresh download.

**"zizmor found but wrong version"** — The script downloads the expected version via the dlx cache. Your system version (e.g. from brew) will be ignored in favor of the correct version.

**"No supported package managers found"** — SFW only creates shims for package managers found on your PATH. Install npm/pnpm/etc. first.

**SFW shims not intercepting** — Make sure `~/.socket/sfw/shims` is at the _front_ of PATH. Run `which npm` — it should point to the shim, not the real binary.
