# Token hygiene

The CLAUDE.md `### Token hygiene` section is the headline rule plus the canonical env-var name. This file is the full spec and the surrounding placeholder / cross-repo-path conventions.

## Headline

Never emit the raw value of any secret to tool output, commits, comments, or replies. The `.claude/hooks/fleet/token-guard/` `PreToolUse` hook blocks the deterministic patterns (literal token shapes, env dumps, `.env*` reads, unfiltered `curl -H "Authorization:"`, sensitive-name commands without redaction). When the hook blocks a command, rewrite. Don't bypass.

Behavior the hook can't catch: redact `token` / `jwt` / `access_token` / `refresh_token` / `api_key` / `secret` / `password` / `authorization` fields when citing API responses. Show key _names_ only when displaying `.env.local`. If a user pastes a secret, treat it as compromised and ask them to rotate.

Full hook spec in [`.claude/hooks/fleet/token-guard/README.md`](../../.claude/hooks/fleet/token-guard/README.md).

## Where tokens live

Tokens belong in env vars (CI) or the OS keychain (dev local). Nowhere else. Never in `.env` / `.env.local` / `.envrc` / `~/.sfw.config` / `~/.config/socket/*` / any dotfile. Dotfiles leak via accidental commits, file-indexers, backup clients, shell-history dumps. Enforced by `.claude/hooks/fleet/no-token-in-dotenv-guard/`.

## Initial setup + rotation

- **Initial setup:** `node .claude/hooks/fleet/setup-security-tools/install.mts` (prompts + persists via macOS Keychain / Linux libsecret / Windows CredentialManager).
- **Rotation:** `node .claude/hooks/fleet/setup-security-tools/install.mts --rotate`. TTY-muted prompt, overwrites the keychain entry unconditionally, ignores stale dotfile / env-var lookup. This is the ONLY correct rotator. Suggesting any other path (`socket login`, hand-editing `~/.sfw.config`, `export SOCKET_API_TOKEN=…` in a shell rc) is a token-hygiene violation.

The Stop-hook flags broken sfw shims, free-vs-enterprise edition drift, and 401-rejection patterns from the last assistant turn (enforced by `.claude/hooks/fleet/setup-security-tools/`).

### Scoped install entrypoints

Four entrypoints share the umbrella installer library for operators who want partial installs:

- `.claude/hooks/fleet/setup-firewall/`: sfw only, `--rotate` honored.
- `.claude/hooks/fleet/setup-claude-scanners/`: AgentShield + zizmor.
- `.claude/hooks/fleet/setup-basics-tools/`: TruffleHog + Trivy + OpenGrep + uv.
- `.claude/hooks/fleet/setup-misc-tools/`: cdxgen + synp + janus.

## Never call platform keychain CLIs from Bash

`security find-generic-password` (macOS), `secret-tool lookup` (Linux), `Get-StoredCredential` (Windows PowerShell), `keyring get` (cross-platform) all surface a UI auth prompt on the user's screen. That prompt fires _per call_, so a hook chain that reads the keychain three times costs three prompts. The token is already cached in process memory after the first resolution (see [`api-token.mts`](../../.claude/hooks/fleet/setup-security-tools/lib/api-token.mts) module-scope cache). Read it from `findApiToken()` or `process.env.SOCKET_API_KEY` / `SOCKET_API_TOKEN` instead.

Writes (`security add-generic-password`, `secret-tool store`, `New-StoredCredential`) and deletes are allowed. They happen during operator-driven setup / rotation, never on hot paths. Bypass: `Allow blind-keychain-read bypass` (enforced by `.claude/hooks/fleet/no-blind-keychain-read-guard/`).

## Personal-path placeholders

When a doc / test / comment needs to show an example user-home path, use the canonical platform-specific placeholder so the personal-paths scanner recognizes it as documentation: `/Users/<user>/...` (macOS), `/home/<user>/...` (Linux), `C:\Users\<USERNAME>\...` (Windows). Don't drift to `<name>` / `<me>` / `<USER>` / `<u>` etc. The scanner accepts anything in `<...>`, but a fleet-wide audit relies on the canonical strings being grep-able. Env vars (`$HOME`, `${USER}`, `%USERNAME%`) also satisfy the scanner.

## Socket API token env var

Two layers, on purpose:

1. **Fleet-canonical name (forward-looking): `SOCKET_API_TOKEN`.** This is what new `.env.example` files, fleet docs, workflow inputs, action `env:` blocks, and CI secrets target. `SOCKET_SECURITY_API_TOKEN` and `SOCKET_SECURITY_API_KEY` remain accepted aliases for one cycle (deprecation grace period).

2. **Local-dev primary slot: `SOCKET_API_KEY`.** Every Socket tool (CLI, SDK, sfw, fleet scripts) reads `SOCKET_API_KEY` without a fallback chain, so picking it as the one stored / exported slot means a single read covers the whole surface. The setup-security-tools install hook stores the token under keychain account `SOCKET_API_KEY` and exports `SOCKET_API_KEY` from the `~/.zshenv` shell-rc-bridge block. Bootstrap hooks read both: `SOCKET_API_KEY` first, `SOCKET_API_TOKEN` as a forward-canonical fallback. A consumer setting either works.

Don't confuse any of these with `SOCKET_CLI_API_TOKEN` (socket-cli's separate setting).

## Clipboard + screen capture

The system clipboard and the screen are exfiltration surfaces. Two separate
concerns:

**Our code.** A script or hook must never read or write the clipboard (a
`pbcopy` / `pbpaste` / `xclip` / `wl-copy` CLI, or an OSC-52 escape) or capture
the screen (`screencapture` / `scrot` / `grim` / `import` / `snippingtool`). The
`no-clipboard-access-guard` and `no-screenshot-guard` PreToolUse hooks block
these at edit/run time; bypass with `Allow clipboard-access bypass` /
`Allow screenshot bypass` for a genuine operator-driven need.

**The Claude Code client (separate from our code).** The TUI auto-copies on
mouse-selection and emits an OSC-52 clipboard escape on each copy (verified in
the client's `setClipboard` path). iTerm2 denies OSC-52 by default and shows a
"terminal attempted to access the clipboard" banner. This is the client, not
fleet tooling, so the guards above do not affect it. The fix is the
`copyOnSelect: false` global setting in `~/.claude.json` (a global-only config
key, read via `getGlobalConfig()`; a project-scoped or `settings.json` value is
ignored). The `setup-claude-config` install step writes it and the
`claude-config-is-hardened` check verifies it stays set. With it off, `ctrl+c`
and `/copy` still copy; only auto-copy-on-select stops.

## Cross-repo path references

`../<fleet-repo>/...` (relative escape) and `/<abs-prefix>/projects/<fleet-repo>/...` (absolute sibling-clone) are both forbidden. Either form hardcodes a clone-layout assumption that breaks in CI / fresh clones / non-standard checkouts. Import via the published npm package (`@socketsecurity/lib/<subpath>`, `@socketsecurity/registry/<subpath>`). Every fleet repo is a real workspace dep. The `cross-repo-guard` PreToolUse hook blocks both forms at edit time; the git-side `scanCrossRepoPaths` gate catches commits/pushes too.
