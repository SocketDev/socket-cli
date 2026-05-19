# Token hygiene

The CLAUDE.md `### Token hygiene` section is the headline rule plus the canonical env-var name; this file is the full spec and the surrounding placeholder / cross-repo-path conventions.

## Headline

Never emit the raw value of any secret to tool output, commits, comments, or replies. The `.claude/hooks/token-guard/` `PreToolUse` hook blocks the deterministic patterns (literal token shapes, env dumps, `.env*` reads, unfiltered `curl -H "Authorization:"`, sensitive-name commands without redaction). When the hook blocks a command, rewrite — don't bypass.

Behavior the hook can't catch: redact `token` / `jwt` / `access_token` / `refresh_token` / `api_key` / `secret` / `password` / `authorization` fields when citing API responses. Show key _names_ only when displaying `.env.local`. If a user pastes a secret, treat it as compromised and ask them to rotate.

Full hook spec in [`.claude/hooks/token-guard/README.md`](../../.claude/hooks/token-guard/README.md).

## Personal-path placeholders

When a doc / test / comment needs to show an example user-home path, use the canonical platform-specific placeholder so the personal-paths scanner recognizes it as documentation: `/Users/<user>/...` (macOS), `/home/<user>/...` (Linux), `C:\Users\<USERNAME>\...` (Windows). Don't drift to `<name>` / `<me>` / `<USER>` / `<u>` etc. — the scanner accepts anything in `<...>` but a fleet-wide audit relies on the canonical strings being grep-able. Env vars (`$HOME`, `${USER}`, `%USERNAME%`) also satisfy the scanner.

## Socket API token env var

Two layers, on purpose:

1. **Fleet-canonical name (forward-looking) — `SOCKET_API_TOKEN`.** This is what new `.env.example` files, fleet docs, workflow inputs, action `env:` blocks, and CI secrets target. `SOCKET_SECURITY_API_TOKEN` and `SOCKET_SECURITY_API_KEY` remain accepted aliases for one cycle (deprecation grace period).

2. **Local-dev primary slot — `SOCKET_API_KEY`.** Every Socket tool (CLI, SDK, sfw, fleet scripts) reads `SOCKET_API_KEY` without a fallback chain, so picking it as the one stored / exported slot means a single read covers the whole surface. The setup-security-tools install hook stores the token under keychain account `SOCKET_API_KEY` and exports `SOCKET_API_KEY` from the `~/.zshenv` shell-rc-bridge block. Bootstrap hooks read both — `SOCKET_API_KEY` first, `SOCKET_API_TOKEN` as a forward-canonical fallback — so a consumer setting either works.

Don't confuse any of these with `SOCKET_CLI_API_TOKEN` (socket-cli's separate setting).

## Cross-repo path references

`../<fleet-repo>/...` (relative escape) and `/<abs-prefix>/projects/<fleet-repo>/...` (absolute sibling-clone) are both forbidden. Either form hardcodes a clone-layout assumption that breaks in CI / fresh clones / non-standard checkouts. Import via the published npm package (`@socketsecurity/lib/<subpath>`, `@socketsecurity/registry/<subpath>`) — every fleet repo is a real workspace dep. The `cross-repo-guard` PreToolUse hook blocks both forms at edit time; the git-side `scanCrossRepoPaths` gate catches commits/pushes too.
