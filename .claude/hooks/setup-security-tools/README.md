# setup-security-tools

A one-command setup helper that downloads and verifies Socket's three
local security tools — **AgentShield**, **zizmor**, and **SFW (Socket
Firewall)** — and wires them into your shell's PATH. Run it once per
machine and you're set.

> Despite living under `.claude/hooks/`, this isn't a Claude Code
> *lifecycle* hook (it doesn't fire on `PreToolUse` / `Stop` / etc.).
> It's just a shared setup script that any fleet repo can invoke as
> `pnpm run setup`. It lives here because it's tightly coupled to the
> claude config it sets up alongside.

## What gets installed

### 1. AgentShield

Scans your Claude Code configuration (`.claude/` directory) for
security issues — prompt injection patterns, leaked secrets,
overly-permissive tool permissions.

**How it's installed**: as an npm package, downloaded via the Socket
dlx system (a pinned-version + integrity-hash cache that lives at
`~/.socket/_dlx/`). The pin is read from `external-tools.json` so
every fleet repo agrees on a version. Subsequent runs reuse the
cache. There's no `devDependencies` entry in the consumer repo.

### 2. zizmor

Static analysis for GitHub Actions workflows. Catches unpinned
actions, secret exposure, template injection, and permission issues.

**How it's installed**: as a native binary, downloaded from
[zizmor's GitHub Releases](https://github.com/zizmorcore/zizmor/releases),
SHA-256 verified against the pinned hash in `external-tools.json`,
cached at `~/.socket/_dlx/`. If you already have zizmor installed
via Homebrew, the download is skipped — but the script still uses
its pinned version, not your system one.

### 3. SFW — Socket Firewall

Intercepts package manager commands (`npm install`, `pnpm add`, etc.)
and scans the resolved packages against Socket.dev's malware database
*before* the install runs. Catches malware that landed in the
registry between your last `pnpm install` and now.

**How it's installed**: as a native binary, downloaded from GitHub,
SHA-256 verified, cached at `~/.socket/_dlx/`. The script also writes
small wrapper scripts ("shims") at `~/.socket/sfw/shims/` — one per
package manager — that transparently route commands through the
firewall. You make sure that directory is at the front of your PATH;
nothing else changes about how you use the tools.

**Free vs. Enterprise**: if `SOCKET_API_KEY` is set in your env,
`.env`, or `.env.local`, the script installs the enterprise SFW
build (which adds gem, bundler, nuget, and go support). Otherwise
it installs the free build (npm, yarn, pnpm, pip, pip3, uv, cargo).

## How to use

```sh
pnpm run setup
```

(That's wired in `package.json` to `node .claude/hooks/setup-security-tools/index.mts`.)

The script will detect whether you have a `SOCKET_API_KEY`, ask if
unsure, then download whatever isn't already cached.

## Where each tool lands

| Tool | Location | Persists across repos? |
|------|---------|------------------------|
| AgentShield | `~/.socket/_dlx/<hash>/agentshield` | Yes |
| zizmor | `~/.socket/_dlx/<hash>/zizmor` | Yes |
| SFW binary | `~/.socket/_dlx/<hash>/sfw` | Yes |
| SFW shims | `~/.socket/sfw/shims/npm`, etc. | Yes |

`<hash>` in `_dlx/<hash>/` is a content-addressed directory keyed off
the pinned version + sha256, so multiple versions can coexist
without colliding.

## Pre-push integration

The `.git-hooks/pre-push` hook (also in this repo) runs
**AgentShield** and **zizmor** automatically before every `git push`.
A failed scan blocks the push. This means you don't have to remember
to run `pnpm run security` manually — every push gets the check.

SFW doesn't run from pre-push (it runs at install time instead — see
the shims).

## Re-running

Safe to run multiple times:

- AgentShield skips the download if the cached binary matches the
  pinned version.
- zizmor skips the download if the cached binary matches the pinned
  version.
- SFW skips the download if cached, and only rewrites the shims if
  the shim contents changed.

## Adopting in a new fleet repo

The hook is self-contained but has three workspace dependencies. To
add it to a new Socket repo:

1. Copy `.claude/hooks/setup-security-tools/` and
   `.claude/commands/setup-security-tools.md`.
2. Make sure the consumer repo's catalog (or `dependencies`) provides
   `@socketsecurity/lib`, `@socketregistry/packageurl-js`, and
   `@sinclair/typebox`.
3. Make sure `.claude/hooks/` isn't gitignored — add
   `!/.claude/hooks/` to `.gitignore` if needed.
4. Add a `setup` script to `package.json`:
   `"setup": "node .claude/hooks/setup-security-tools/index.mts"`.
5. Run `pnpm install` so the hook's workspace deps resolve.

## Troubleshooting

**"AgentShield install failed"** — Check that your machine can reach
the npm registry. The dlx system caches at `~/.socket/_dlx/`. Clear
the cache (`safe-delete ~/.socket/_dlx/`) to force a fresh download.

**"zizmor found but wrong version"** — The script intentionally
downloads the pinned version into the dlx cache, ignoring whatever
version you have via Homebrew. The pin lives in `external-tools.json`.

**"No supported package managers found"** — SFW only creates shims
for package managers found on your `PATH` at install time. Install
npm/pnpm/whatever first, then re-run setup.

**SFW shims not intercepting** — Make sure `~/.socket/sfw/shims` is
at the *front* of your `PATH`. Run `which npm` — it should point at
the shim under `~/.socket/sfw/shims/`, not the real binary.

## Cross-fleet sync

This README and the hook itself live in
[`socket-repo-template`](https://github.com/SocketDev/socket-repo-template/tree/main/template/.claude/hooks/setup-security-tools)
and are required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.
