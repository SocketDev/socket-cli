# setup-firewall

Operator-invoked installer for **Socket Firewall** (sfw enterprise +
free). Slim leaf of the `setup-security-tools` umbrella.

## When to use

- You want to install or refresh ONLY the firewall surface without
  re-running the AgentShield / zizmor / socket-basics tool
  installers.
- You're rotating `SOCKET_API_KEY` and want sfw to re-resolve
  enterprise vs free without touching everything else.

```sh
# Install / verify
node .claude/hooks/setup-firewall/install.mts

# Rotate the API token (re-prompts; overwrites keychain)
node .claude/hooks/setup-firewall/install.mts --rotate
```

## Relationship to setup-security-tools

The umbrella `setup-security-tools/install.mts` does everything this
leaf does PLUS AgentShield + zizmor + socket-basics tools (TruffleHog,
Trivy, OpenGrep, uv) + a few misc tools (cdxgen, synp, janus).

This leaf is a thin re-entry point that imports from the umbrella's
`lib/installers.mts` and runs ONLY the firewall installer. The token
resolution / keychain / shell-rc bridge / --rotate prompt all use the
umbrella's exported helpers — single source of truth.

## What gets installed

| Surface                                                            | Source                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| sfw binary (enterprise or free, depending on token)                | github:SocketDev/firewall-release (enterprise) / SocketDev/sfw-free |
| PATH shims for npm / pnpm / yarn / pip / uv / cargo / etc.         | `~/.socket/sfw/shims/`                                              |
| Shell-rc env block (`~/.zshenv` on macOS)                          | `setup-security-tools/lib/shell-rc-bridge.mts`                      |
| OS keychain entry (macOS Keychain / libsecret / CredentialManager) | `setup-security-tools/lib/token-storage.mts`                        |
