# Commit signing

Every commit landing on a default branch (`main` / `master`) in the fleet must carry a verified signature. Three independent layers enforce this; bypassing any one of them is treated as exceptional and one-shot.

## Layer 1: local config gate (pre-commit)

Before git records a commit, the pre-commit hook reads:

```
git config --get commit.gpgsign      # expect: true
git config --get user.signingkey     # expect: a key ID or .pub path
```

If `commit.gpgsign` is not `true`, OR `user.signingkey` is unset, the hook fails with the fix command and a pointer to the setup helper. The check reads the union of local + global config, so a globally-configured signing key satisfies it for every repo.

Bypass (exceptional only; hotfix scenarios, in-flight signing-tool outage):

```sh
SOCKET_PRE_COMMIT_ALLOW_UNSIGNED=1 git commit ...
```

One-shot; never persist in shell rc. The env var is read on every invocation, so dropping it returns to the gated state.

## Layer 2: push-time signature check (pre-push)

The pre-push hook fires after commits exist. It reads `git log --format='%H %G?' <range>` across the push range and inspects the verification marker per commit:

- `G`: good GPG signature (block: no)
- `U`: good GPG, unknown trust (block: no)
- `E`: missing-key but otherwise valid (block: no)
- `X`: good signature on expired key (block: no)
- `Y`, `R`: revoked/expired key, good signature (block: no)
- `N`: no signature (BLOCK)
- `B`: bad / unverifiable signature (BLOCK)

Scope: only fires when pushing to `refs/heads/main` or `refs/heads/master`. Topic branches push unsigned freely; signing matters at the point of landing on the protected ref.

No bypass. Unsigned commits on `main`/`master` are always blocked — sign the commits and retry.

## Layer 3: server-side (GitHub branch protection)

`lint-github-settings.mts` audits the default branch's protection on GitHub for `required_signatures: { enabled: true }`. If the audit reports drift, the operator fixes it via the GitHub branch-protection UI (this script's `--fix` does not auto-apply branch-protection patches because that endpoint can clobber custom status-check requirements).

GitHub-side enforcement is the failsafe: it catches pushes that somehow bypassed both local layers (an attacker who manipulated `core.hooksPath`, a CI pipeline that pushed without running hooks, a freshly-created fleet repo whose hooks aren't yet installed).

## Setup helper

The setup helper detects available signing methods and configures git in one shot:

```sh
node .claude/hooks/fleet/setup-signing/install.mts            # detect + configure
node .claude/hooks/fleet/setup-signing/install.mts --check    # report status (exit 0 if configured, 1 if not)
node .claude/hooks/fleet/setup-signing/install.mts --force    # overwrite existing config
```

Detection order (first hit wins):

1. **1Password SSH agent**: agent socket at platform-specific path, queried via `ssh-add -L`. Recommended: keys never touch disk, biometric unlock on use, signing happens inside 1Password.
2. **SSH key on disk**: `~/.ssh/id_ed25519.pub` (preferred), `id_ecdsa.pub`, then `id_rsa.pub`. `user.signingkey` points at the `.pub` path.
3. **GPG secret key**: `gpg --list-secret-keys --with-colons`, first `sec:` entry. `user.signingkey` set to the long key ID.

The helper never generates keys (user's call) and never uploads keys to GitHub. After running, upload the public key as a Signing Key at https://github.com/settings/keys to get the "Verified" badge on web-rendered commits.

## Why three layers

Each layer catches a different failure mode:

- Pre-commit catches **misconfiguration** at the earliest possible moment (no signing tool set up).
- Pre-push catches **bypass attempts** at the commit level (`--no-gpg-sign`, cherry-picks from unsigned sources, rebases without re-signing).
- GitHub branch protection catches **process bypass** at the network level (push from a host with no fleet hooks installed, CI pipeline that pushes without verification).

A single layer can be defeated with one operator mistake or one compromised host. Three independent layers require simultaneous compromise of all three to land an unsigned commit on a protected branch.

## When to use the bypass envs

Only when:

1. A signing-tool outage (1Password down, GPG agent crashed) blocks an urgent push that genuinely cannot wait
2. A history-rewriting operation imports unsigned commits from external sources (rare; usually those should be re-signed during the rewrite)
3. A maintenance script needs to commit/push automation artifacts and the operator has explicitly chosen to skip signing for that automation

Never set either env var in `.zshrc` / `.bashrc` / `direnv` files. The whole point of the one-shot semantics is that the operator notices each bypass; a persistent env defeats that.
