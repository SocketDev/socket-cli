# brew-supply-chain-guard

PreToolUse(Bash) hook. **Blocks** a `brew` invocation when this machine's
Homebrew is not hardened to the 6.0.0 supply-chain posture.

## Why

Homebrew 6.0.0 ([release notes](https://brew.sh/2026/06/11/homebrew-6.0.0/))
added two opt-in supply-chain controls plus the version floor they depend on:

- **Tap trust** — `HOMEBREW_REQUIRE_TAP_TRUST=1` refuses to evaluate a
  third-party tap's code until it is explicitly trusted (`brew trust …`).
  Closes the tap-as-RCE surface ([Tap-Trust](https://docs.brew.sh/Tap-Trust)).
- **Cask checksums** — `HOMEBREW_CASK_OPTS_REQUIRE_SHA=1` refuses a cask whose
  download has no pinned checksum (`sha256 :no_check`)
  ([Supply-Chain-Security](https://docs.brew.sh/Supply-Chain-Security)).

Both env knobs are silently ignored by an older Homebrew, so the only real
enforcement is a **version floor**: a `brew` below 6.0.0 can't be hardened and
is blocked until the operator upgrades.

This is a distinct concern from `package-manager-auto-update-guard` (which owns
`HOMEBREW_NO_AUTO_UPDATE`, "don't change a tool version mid-task"). Both read
the same source-of-truth lib so they never diverge: this guard reads
`_shared/brew-supply-chain.mts`; the audit (`check --all`) and the
`setup-security-tools` shell-rc bridge read it too.

## What it blocks

A Bash command invoking `brew` while the machine reports either:

| Condition                              | Fix                                                       |
| -------------------------------------- | --------------------------------------------------------- |
| Homebrew < 6.0.0                       | `brew update && brew upgrade` (or reinstall) to ≥6.0.0    |
| `HOMEBREW_REQUIRE_TAP_TRUST` unset     | `export HOMEBREW_REQUIRE_TAP_TRUST=1`                     |
| `HOMEBREW_CASK_OPTS_REQUIRE_SHA` unset | `export HOMEBREW_CASK_OPTS_REQUIRE_SHA=1`                 |

`setup-security-tools` persists both env knobs into the managed shell-rc block.
A machine without `brew` on PATH (`absent`) passes — the check is not
applicable (CI runners legitimately lack brew).

## Bypass

`Allow brew-supply-chain bypass` typed verbatim in a recent user turn.

## Fix instead of bypassing

```sh
node .claude/hooks/fleet/setup-security-tools/install.mts
```

sets both env knobs. Upgrade Homebrew itself with `brew update && brew upgrade`.

Fails open on parse / payload errors (exit 0) — a guard bug must not wedge every
Bash call.
