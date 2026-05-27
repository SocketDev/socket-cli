# setup-signing

Install-only helper that configures git commit signing. Paired with
the pre-commit signing-config gate and pre-push signed-commits
enforcement — those hooks REQUIRE signing; this helper makes the
one-time setup mechanical.

## Usage

```sh
node .claude/hooks/setup-signing/install.mts            # detect + configure
node .claude/hooks/setup-signing/install.mts --check    # report status; exit 0 if configured, 1 if not
node .claude/hooks/setup-signing/install.mts --force    # overwrite existing config
```

## Detection order

The helper picks the FIRST available signing method in this order:

1. **1Password SSH agent** — checks the agent socket and queries
   `ssh-add -L`. Recommended path: keys never touch disk, biometric
   unlock on use.
2. **SSH key on disk** — `~/.ssh/id_ed25519.pub` (preferred), then
   `id_ecdsa.pub`, then `id_rsa.pub`. Sets `user.signingkey` to the
   `.pub` path (git's documented convention for SSH signing).
3. **GPG secret key** — `gpg --list-secret-keys --with-colons` first
   `sec:` entry. Sets `user.signingkey` to the long key ID and
   `gpg.format=openpgp`.

If none of these are detected, the helper prints setup instructions
for each path and exits 1.

## What it sets

For SSH:

```
git config --global commit.gpgsign  true
git config --global user.signingkey <pub-key-or-path>
git config --global gpg.format       ssh
# If 1Password path on macOS:
git config --global gpg.ssh.program  /Applications/1Password.app/Contents/MacOS/op-ssh-sign
```

For GPG:

```
git config --global commit.gpgsign  true
git config --global user.signingkey <KEYID>
git config --global gpg.format       openpgp
```

## What it does NOT do

- **Never generates keys.** Key creation is the user's call.
- **Never uploads keys to GitHub.** The user uploads the public key as
  a Signing Key at https://github.com/settings/keys to get the
  "Verified" badge on commits.
- **Never disables an existing config.** Without `--force`, the
  helper exits early if signing is already configured.
