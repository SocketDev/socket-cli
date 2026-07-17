---
name: setup-repo
description: Run the full repo onboarding wizard for tokens, keychain, shell bridge, tools, hooks, and initialization.
user-invocable: true
allowed-tools: Read, Bash, Edit, Write
model: claude-sonnet-4-6
context: fork
---

# setup-repo

Master onboarding wizard. Runs each setup phase in order, skips phases already complete, and surfaces a clear summary at the end.

## When to Use

- First time cloning a fleet repo on a new machine
- Onboarding a new engineer to any socket-\* repo
- After a machine rebuild or credential rotation
- When `/setup-security-tools` reports missing tools or a bad token

## Sub-setups (each runnable standalone via scripts)

| Script                                                     | What it does                                   |
| ---------------------------------------------------------- | ---------------------------------------------- |
| `node scripts/fleet/setup/token.mts`                       | API token → OS keychain + shell rc bridge      |
| `node scripts/fleet/setup/claude-config.mts`               | Harden `~/.claude.json` (`copyOnSelect: false`) |
| `node scripts/fleet/install-sfw.mts`                       | Socket Firewall shims                          |
| `/setup-security-tools` (agentshield, zizmor)              | Security scanners — installed by the SessionStart hook, not standalone scripts |

`/setup-repo` runs all scripts in the order below and produces a summary.

## Phases

Run each phase in order. Skip any phase whose check reports "already done." After all phases, print a summary table.

---

### Phase 0 — Preflight

```bash
node --version          # must be >= 22.6
pnpm --version          # must be present
git config user.email   # must be set
```

If Node < 22.6: stop and tell the engineer to upgrade (nvm / fnm recommended). The native host and type-stripping require Node 22.6+.

---

### Phase 1 — API Token

Check for an existing token:

```bash
node .claude/hooks/fleet/setup-security-tools/install.mts --check-token
```

If missing or `--rotate` was passed, run the interactive install to prompt and persist to the OS keychain:

```bash
node .claude/hooks/fleet/setup-security-tools/install.mts
```

This writes `SOCKET_API_TOKEN` **and** `SOCKET_API_KEY` to the OS keychain:

- macOS: Keychain Access (`security add-generic-password`, service `socket-cli`)
- Linux: `secret-tool store`, service `socket-cli`
- Windows: PowerShell CredentialManager → DPAPI file fallback

Skip if the token is already present and `--rotate` was not passed.

---

### Phase 2 — Shell RC Bridge

Ensures `SOCKET_API_KEY` is exported in the user's shell so every terminal session has it without a keychain read.

Runs automatically as part of Phase 1 (`wireBridgeIntoShellRc` in `operator-prompts.mts`). Verify it landed:

```bash
grep -l "SOCKET_API_KEY" ~/.zshrc ~/.bashrc ~/.bash_profile ~/.config/fish/config.fish 2>/dev/null | head -1
```

If missing (CI machine, fish shell, non-standard rc): tell the engineer to add:

```sh
export SOCKET_API_KEY="$(security find-generic-password -s socket-cli -a SOCKET_API_KEY -w 2>/dev/null)"
```

---

### Phase 3 — Native Messaging Host

Installs the Chrome native messaging host manifest so the Trusted Publisher extension can read the token from the keychain without requiring `SOCKET_API_TOKEN` in the browser environment.

```bash
node -e "import('@socketsecurity/lib-stable/native-messaging/install').then(m => {
  const r = m.installNativeHost({ allowedOrigins: ['*'] })
  console.log('installed:', r.manifestPaths.join(', '))
})"
```

Manifest lands at:

- macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/dev.socket.trusted_publisher_host.json`
- Linux: `~/.config/google-chrome/NativeMessagingHosts/dev.socket.trusted_publisher_host.json`
- Windows: `%APPDATA%\Google\Chrome\User Data\NativeMessagingHosts\` + HKCU registry key

Skip if the manifest file already exists and the token hasn't rotated.

---

### Phase 4 — Security Tools

Runs the full security toolchain installer:

```bash
node .claude/hooks/fleet/setup-security-tools/install.mts
```

Installs: AgentShield, Zizmor, SFW (Socket Firewall), TruffleHog, Trivy, OpenGrep, uv, Janus, cdxgen, synp. Each is skipped if already current.

After install, add the SFW shim directory to PATH if not already present:

```bash
export PATH="$HOME/.socket/_wheelhouse/shims:$PATH"
```

---

### Phase 5 — Repo Initialization

```bash
pnpm install            # install deps
pnpm run check --all    # verify the repo is green
```

If `pnpm run check` fails, surface the failures and stop — the repo needs fixing before it's usable.

---

## Summary Table

After all phases complete, print:

```
Phase                   Status
─────────────────────── ──────────────────────────────
Preflight               ✓ Node 22.14 / pnpm 10.x
API Token               ✓ found via keychain (SOCKET_API_TOKEN)
Shell RC Bridge         ✓ ~/.zshrc
Native Messaging Host   ✓ ~/Library/...NativeMessagingHosts/...json
Security Tools          ✓ AgentShield · Zizmor · SFW · 7 more
Repo Init               ✓ pnpm install + check passed
```

---

## Options

Pass these in chat when invoking:

| Option               | Effect                                                             |
| -------------------- | ------------------------------------------------------------------ |
| `--rotate`           | Re-prompt for the API token even if one exists                     |
| `--skip-tools`       | Skip Phase 4 (security tools) — useful on CI/headless              |
| `--skip-native-host` | Skip Phase 3 (native messaging host) — non-browser environments    |
| `--check`            | Check-only mode: report what's missing without installing anything |

---

## Orchestration Notes

- Phases 1–4 call into `setup-security-tools/install.mts` which already handles idempotency — re-running is safe.
- Phase 3 (`installNativeHost`) is in `@socketsecurity/lib-stable/native-messaging/install`. If that module isn't built yet (pre-6.0.8), skip gracefully.
- Never prompt interactively in CI (`getCI()` returns true). In CI, skip Phases 1–3 silently and report "CI environment — keychain setup skipped."
- Phase 5 (`pnpm install + check`) is the only phase that can fail the wizard hard. All other failures are surfaced as warnings with recovery hints.
