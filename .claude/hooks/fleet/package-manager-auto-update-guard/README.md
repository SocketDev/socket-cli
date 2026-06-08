# package-manager-auto-update-guard

PreToolUse(Bash) hook. **Blocks** a package-manager invocation when that
manager's auto-update is still enabled on this machine.

## Why

A package manager that auto-updates can change a tool's version underneath a
build / scan, add latency, or pull an unsoaked package — a reproducibility +
supply-chain hazard. The disable-knob lives outside the repo (env vars, npmrc,
chocolatey.config, winget settings) so it drifts per machine. This hook is the
point-of-use enforcement; `scripts/fleet/audit-package-manager-auto-update.mts`
is the on-demand / `check --all` audit; `setup-security-tools` sets the knobs.
All three read the same `_shared/package-manager-auto-update.mts` (code is law,
DRY).

## What it blocks

A Bash command invoking a covered manager while that manager reports auto-update
**enabled**:

| Manager    | Platform | Disable knob                                   |
| ---------- | -------- | ---------------------------------------------- |
| Homebrew   | macOS    | `HOMEBREW_NO_AUTO_UPDATE=1`                     |
| Chocolatey | Windows  | `choco feature disable -n autoUpdate`          |
| winget     | Windows  | `settings.json` source `autoUpdateInterval: 0` |
| Scoop      | Windows  | no scheduled `scoop update` task               |
| npm        | all      | `update-notifier=false` / `NO_UPDATE_NOTIFIER` |
| pnpm       | all      | `NO_UPDATE_NOTIFIER=1`                          |

A manager that isn't installed (`absent`) or already hardened (`disabled`)
passes.

## Bypass

| To green…              | Phrase                                       |
| ---------------------- | -------------------------------------------- |
| one manager (e.g. brew) | `Allow brew auto-update bypass`             |
| all managers            | `Allow package-manager-auto-update bypass`  |

Per-manager phrases accept either the binary name (`brew`) or the manager id
(`homebrew`).

## Fix instead of bypassing

```sh
node .claude/hooks/fleet/setup-security-tools/install.mts
```

sets every manager's auto-update-off knob.
