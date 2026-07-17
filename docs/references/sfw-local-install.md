# Socket Firewall — local install

Install Socket Firewall (sfw) enterprise on your dev machine so every
package fetch — `npm install`, `pnpm add`, `cargo build`, `pip install`,
etc. — runs through the same firewall checks that CI runs. Mirrors the
shim setup in [`SocketDev/socket-registry/.github/actions/setup`](https://github.com/SocketDev/socket-registry/blob/main/.github/actions/setup/action.yml)
exactly, so local and CI behavior stay aligned.

## Prerequisites

- A Socket API token with firewall scopes from app.socket.dev → API tokens.
- `gh auth login` set up (the enterprise binary lives in the private
  `SocketDev/firewall-release` repo).
- macOS or Linux (Windows works in CI but the install script below is
  unix-only; adapt as needed).

## Install

### 1. Persist the API token to the OS keychain

Use the canonical wheelhouse rotator. **Never** hand-edit dotfiles
(`~/.sfw.config`, `.env`, etc.) — see CLAUDE.md _Token hygiene_ for
the rule.

```bash
node .claude/hooks/fleet/setup-security-tools/install.mts --rotate
```

The command prompts (TTY-muted) for the token and writes it to the
OS keychain (macOS Keychain / Linux libsecret / Windows
CredentialManager). The canonical keychain entry name is
`SOCKET_API_KEY` because that's the one slot every Socket tool reads
without a fallback chain (CLI, SDK, sfw, fleet scripts).
`SOCKET_API_TOKEN` is the forward-canonical variable name accepted as
a secondary read. Both are distinct from `SOCKET_CLI_API_TOKEN`
(socket-cli's separate setting).

The sfw enterprise binary reads from the keychain via
`@socketsecurity/lib`'s `readSocketApiToken()` helper (or its
`resolve({ service: 'socket-cli', accounts: [...] })` primitive on
older lib versions).

### 2. Download the enterprise binary

Pull the version + sha256 from `socket-registry/external-tools.json`
(canonical fleet pin):

```bash
TOOLS=~/projects/socket-registry/external-tools.json
SFW_VERSION=$(node -e "console.log(require('$TOOLS').sfw.version)")
PLATFORM=darwin-arm64   # or: darwin-x64, linux-x64, linux-arm64, linux-x64-musl, linux-arm64-musl
ASSET=$(node -e "console.log(require('$TOOLS').sfw.enterprise.checksums['$PLATFORM'].asset)")
SHA=$(node -e "console.log(require('$TOOLS').sfw.enterprise.checksums['$PLATFORM'].sha256)")

# Real binary racks at rack/sfw/<version>/sfw; bin/ holds the flat handle.
mkdir -p ~/.socket/_wheelhouse/rack/sfw/$SFW_VERSION ~/.socket/_wheelhouse/bin
gh release download "v$SFW_VERSION" --repo SocketDev/firewall-release \
  --pattern "$ASSET" --output ~/.socket/_wheelhouse/rack/sfw/$SFW_VERSION/sfw --clobber

ACTUAL=$(shasum -a 256 ~/.socket/_wheelhouse/rack/sfw/$SFW_VERSION/sfw | cut -d' ' -f1)
[ "$ACTUAL" = "$SHA" ] || { echo "sha mismatch"; exit 1; }
chmod +x ~/.socket/_wheelhouse/rack/sfw/$SFW_VERSION/sfw
ln -sfn ~/.socket/_wheelhouse/rack/sfw/$SFW_VERSION/sfw ~/.socket/_wheelhouse/bin/sfw
```

### 3. Generate the shims

The fleet bootstrap owns shim generation — one deterministic generator,
no hand-saved script:

```bash
node scripts/fleet/setup/setup-tools.mjs
```

It writes the shims into `~/.socket/_wheelhouse/bin/` (the one PATH
entry, where they co-live with the flat racked-tool handles like
`bin/sfw`). Re-run it whenever you install or uninstall a wrapped tool.

The shim list — `npm yarn pnpm pip pip3 uv cargo` (enterprise adds
`gem bundler nuget`, plus `go` on Linux) — mirrors socket-registry's
setup action. For each command:

- Racked tools (npm/pnpm/uv) wrap the PINNED rack binary
  (`rack/<tool>/<version>/…`); other tools resolve from PATH with every
  Socket shim dir stripped and shim-fingerprinted candidates skipped, so
  a shim never wraps another shim.
- Each shim exports a per-tool `SOCKET_SHIM_ACTIVE_<CMD>` sentinel before
  handing off to sfw. A re-entrant invocation (a child process the wrapped
  tool spawns, or the tool re-invoking its own name via a bare PATH lookup)
  sees the sentinel already set and execs the real binary directly — PATH
  itself is never touched, so every OTHER racked shim (`uv`, `cargo`, …)
  stays resolvable by the tool's own children.
- The wrapper **exports `SFW_UNKNOWN_HOST_ACTION=ignore`** (so non-
  allowlisted hosts pass through unscored instead of being blocked —
  sfw-free ignores this var since it hardcodes 'ignore' internally; sfw-
  enterprise reads it and would otherwise default to 'block'), and
  execs `<sfw> <real> "$@"`.
- If the real binary is missing, a helpful-error stub prints the
  install hint and exits 127.

The stub matters: without it, a workflow that calls a missing tool
fails with a generic "command not found" instead of a self-explanatory
"× sfw: nuget is not installed on this runner. Install NuGet from …".

See the canonical CI version in
[`socket-registry/.github/actions/setup/action.yml`](https://github.com/SocketDev/socket-registry/blob/main/.github/actions/setup/action.yml)
under the "Create sfw shims" step. (An older per-machine rack at
`~/.socket/sfw/shims` with its own `regenerate-shims.sh` may still exist
on long-lived machines; it is legacy — prefer the fleet generator.)

### 4. Add the shim dir to PATH

```bash
echo '
# Socket Firewall (sfw) enterprise — wraps npm/pnpm/cargo/uv/pip3/gem/bundler.
# Token lives in OS keychain (via `node .claude/hooks/fleet/setup-security-tools/install.mts --rotate`).
# To bypass for one command: PATH="${PATH/$HOME\/.socket\/_wheelhouse\/bin:/}" <cmd>
export PATH="$HOME/.socket/_wheelhouse/bin:$PATH"' >> ~/.zshrc
```

Open a fresh shell. `which npm` should resolve to `~/.socket/_wheelhouse/bin/npm`,
and `npm --version` should print `Protected by Socket Firewall` before
the version number.

## Drift watch

The sfw version + per-platform sha256s live in
`socket-registry/external-tools.json`. When CI bumps that file, your
local install drifts. Re-run the install steps above whenever you pull
socket-registry. The local file `~/.socket/_wheelhouse/bin/sfw-<old-version>` is
safe to keep — the `sfw` symlink is what matters.

CLAUDE.md's "Drift watch" rule applies here: if you see a different sfw
version pinned in another fleet repo, opt for the latest. The repo with
the newer version is canonical.

## Bypass for one command

```bash
PATH="${PATH/$HOME\/.socket\/_wheelhouse\/bin:/}" npm install
```

Useful when debugging an install issue you suspect sfw is causing — but
prefer to file a real fix rather than living in bypass mode.

## Uninstall

```bash
rm -rf ~/.socket/_wheelhouse
# Remove the PATH export from ~/.zshrc by hand.
# Delete the token from the OS keychain via the rotator's delete flow,
# or hand-clear via `security delete-generic-password -s socket-cli` (macOS),
# `secret-tool clear service socket-cli` (Linux), or the Credential Manager UI (Windows).
```

Also revoke the token at app.socket.dev once you remove it locally.
