---
description: Install all Socket security tools — SFW, AgentShield, Zizmor, TruffleHog, Trivy, OpenGrep, and more. Also prompts for the API token and persists it to the OS keychain. Run /setup-repo for the full onboarding wizard.
---

Install all Socket security tools for local development.

## What this sets up

| Tool            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| **AgentShield** | Scans Claude config for prompt injection and secrets              |
| **Zizmor**      | Static analysis for GitHub Actions workflows                      |
| **SFW**         | Socket Firewall — intercepts package installs to scan for malware |
| **TruffleHog**  | Secret scanning                                                   |
| **Trivy**       | Container and filesystem vulnerability scanning                   |
| **OpenGrep**    | Semantic code analysis                                            |
| **uv**          | Python package manager (for tools with Python deps)               |

Also: API token prompt → OS keychain, native messaging host, shell rc bridge.

## Sub-commands (run individually if needed)

- `/setup-token` — token + keychain only
- `/setup-native-host` — Chrome native host manifest
- `/setup-trusted-publisher-extension` — Trusted Publisher extension
- `/setup-sfw` — SFW only
- `/setup-agentshield` — AgentShield only
- `/setup-zizmor` — Zizmor only

## Run everything

```bash
node .claude/hooks/fleet/setup-security-tools/install.mts
```

After the script completes, add the SFW shim directory to PATH:

```bash
export PATH="$HOME/.socket/_wheelhouse/shims:$PATH"
```

## Notes

- Safe to re-run (idempotent — skips tools already at current version)
- Token is stored in the OS keychain, NOT in `.env.local`
- `/update-security` will check for new versions of these tools
