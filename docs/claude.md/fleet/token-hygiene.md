# Token hygiene

The CLAUDE.md `### Token hygiene` section is the headline rule plus the canonical env-var name; this file is the full spec and the surrounding placeholder / cross-repo-path conventions.

## Headline

Never emit the raw value of any secret to tool output, commits, comments, or replies. The `.claude/hooks/token-guard/` `PreToolUse` hook blocks the deterministic patterns (literal token shapes, env dumps, `.env*` reads, unfiltered `curl -H "Authorization:"`, sensitive-name commands without redaction). When the hook blocks a command, rewrite — don't bypass.

Behavior the hook can't catch: redact `token` / `jwt` / `access_token` / `refresh_token` / `api_key` / `secret` / `password` / `authorization` fields when citing API responses. Show key _names_ only when displaying `.env.local`. If a user pastes a secret, treat it as compromised and ask them to rotate.

Full hook spec in [`.claude/hooks/token-guard/README.md`](../../.claude/hooks/token-guard/README.md).

## Personal-path placeholders

When a doc / test / comment needs to show an example user-home path, use the canonical platform-specific placeholder so the personal-paths scanner recognizes it as documentation: `/Users/<user>/...` (macOS), `/home/<user>/...` (Linux), `C:\Users\<USERNAME>\...` (Windows). Don't drift to `<name>` / `<me>` / `<USER>` / `<u>` etc. — the scanner accepts anything in `<...>` but a fleet-wide audit relies on the canonical strings being grep-able. Env vars (`$HOME`, `${USER}`, `%USERNAME%`) also satisfy the scanner.

## Socket API token env var

The canonical fleet name is `SOCKET_API_TOKEN`. The legacy names `SOCKET_API_KEY`, `SOCKET_SECURITY_API_TOKEN`, and `SOCKET_SECURITY_API_KEY` are accepted as aliases for one cycle (deprecation grace period) — bootstrap hooks read all four and normalize to `SOCKET_API_TOKEN` going forward. New `.env.example` files, docs, workflow inputs, and action env exports use `SOCKET_API_TOKEN`. Don't confuse with `SOCKET_CLI_API_TOKEN` (socket-cli's separate setting).

## Cross-repo path references

`../<fleet-repo>/...` (relative escape) and `/<abs-prefix>/projects/<fleet-repo>/...` (absolute sibling-clone) are both forbidden. Either form hardcodes a clone-layout assumption that breaks in CI / fresh clones / non-standard checkouts. Import via the published npm package (`@socketsecurity/lib/<subpath>`, `@socketsecurity/registry/<subpath>`) — every fleet repo is a real workspace dep. The `cross-repo-guard` PreToolUse hook blocks both forms at edit time; the git-side `scanCrossRepoPaths` gate catches commits/pushes too.
