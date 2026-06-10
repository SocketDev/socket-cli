# gh-token-hygiene-guard

PreToolUse hook on Bash commands invoking `gh`. Enforces four
invariants motivated by the May 2026 Nx Console supply-chain
compromise (a malicious npm package read `~/.config/gh/hosts.yml` and
used the token against the GitHub API within 74 seconds of install).

1. **Keychain storage.** Token must live in the OS keychain
   (`gh auth status` reports `(keyring)`). On-disk
   `~/.config/gh/hosts.yml` is rejected; no bypass. Detection is
   **per-host**: the hook isolates the `github.com` block from
   `gh auth status` before checking, so a keyring-backed
   `github.enterprise.com` login can't mask a file-backed
   `github.com` token.
2. **8-hour token age cap.** The hook stamps a local timestamp on
   `gh auth login` / `gh auth refresh` and blocks every non-auth `gh`
   command after 8 hours. Self-recovery: `gh auth refresh -h
github.com` is always allowed (re-stamps the file). This cap lives
   in THIS hook, not `auth-rotation-reminder` (which handles non-gh
   CLIs like npm / pnpm / gcloud / docker / vault).
3. **`workflow` scope is on-demand, single-use, physical-presence-gated.**
   Recommended default scopes: `read:org, repo` (the hook does not
   enforce a scope allowlist; gh forces `gist` as a minimum, so the
   practical floor is `read:org, repo, gist`). To add the scope:
   - Type `Allow workflow-scope bypass` in chat. **The phrase alone is
     not enough** — an attacker who forges the chat-typed slot still
     can't proceed without your physical presence.
   - The hook runs **OS physical-presence authentication** (Touch ID /
     YubiKey / fingerprint — see "Physical-presence auth" below).
   - On success, `gh auth refresh -h github.com -s workflow` is let
     through and the hook records a **session-bound** grant at
     `~/.claude/gh-workflow-grant` (body = `<session_id>\n<unix_ms>`).
   - The next `gh workflow run` verifies the grant's `session_id`
     matches the dispatching session, then consumes it (deletes the
     file). A grant planted by another process or a stale session is
     rejected.
   - A second dispatch requires a fresh bypass + auth cycle.
4. **Workflow scope revoke is always allowed** without bypass or auth
   (`gh auth refresh -r workflow`), so users can clean up after a
   dispatch.

The dispatch gate also covers the API shape
(`gh api .../actions/workflows/.../dispatches`), not just
`gh workflow run` / `gh workflow dispatch`.

## Operational state

Two files under `~/.claude/`:

- `gh-token-issued-at` — local timestamp of the last `gh auth login` /
  `gh auth refresh`. Drives the 8h age check. First run stamps "now"
  and treats the token as fresh (so the hook ships without forcing
  every dev to re-auth on upgrade).
- `gh-workflow-grant` — **session-bound** marker for an unconsumed
  workflow-dispatch authorization. Body is `<session_id>\n<unix_ms>`.
  Presence alone is insufficient — the dispatch step cross-checks the
  recorded `session_id` against the current Claude session. Deleted as
  soon as a dispatch is let through.

## Threat model & design choices

- **Session-bound grants (not presence-only).** A presence-only marker
  could be pre-created by a malicious postinstall (`touch
~/.claude/gh-workflow-grant`) before Claude even launches. Binding
  the grant to the `session_id` the harness provides means a planted
  grant from another process / session is rejected — the attacker
  can't guess a session id the hook will later receive.
- **Physical presence on top of the chat phrase.** The single most
  dangerous capability (dispatching workflows with access to all repo
  secrets incl. npm publish tokens) is gated by a per-use biometric /
  hardware-key check, not just a chat phrase that an injected agent
  could emit.
- **Absolute `/usr/bin/` paths for sudo / dscl / osascript.** Defeats
  PATH-hijack — a postinstall that drops `~/.local/bin/sudo` can't
  intercept the auth call. (`gh` itself stays PATH-resolved; there's
  no single canonical path across Homebrew / Intel / Linux.)
- **Known gaps** (documented in
  [`docs/agents.md/fleet/security-stack.md`](../../../docs/agents.md/fleet/security-stack.md)):
  the transcript JSONL the bypass-phrase check reads is
  unauthenticated (needs harness HMAC), and `containsGhInvocation` is
  regex-based, not AST-based (shell-variable / eval evasion possible).

## Escape hatches

None. The hook is failsafe-deny on its core invariants and
fail-closed on the auth path (no working physical-presence method →
block, never silently pass). There is **no test-only env-var
override** — `SOCKET_GH_HYGIENE_TEST_AUTH` was removed 2026-05-26
because an attacker who planted it in a shell rc / `.envrc` / VS Code
terminal env would have bypassed Touch ID. The OS-auth path is
intentionally unreachable in unit tests and is exercised by manual
smoke-testing instead.

## Physical-presence auth (cross-platform)

The workflow-scope bypass (invariant 3) requires biometric / hardware
confirmation after the chat phrase. What works per platform:

| Platform                                 | Path                               | Notes                                                                                                                          |
| ---------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **macOS + Touch ID**                     | `pam_tid.so` on sudo               | Best. Setup below.                                                                                                             |
| **macOS + osascript, no MDM**            | password dialog → `dscl -authonly` | Fallback when Touch ID isn't configured.                                                                                       |
| **macOS + MDM (iru/Jamf/Mosyle/Kandji)** | Touch ID only                      | osascript is blocked by org policy; the hook detects the MDM install on disk and skips osascript (no "Process Blocked" toast). |
| **Linux + YubiKey**                      | `pam_u2f.so` on sudo               | FIDO2 device.                                                                                                                  |
| **Linux + fingerprint reader**           | `pam_fprintd.so` on sudo           | ThinkPad / Framework / some Dells.                                                                                             |
| **Linux, no biometric/key**              | —                                  | `unsupported` → block. Error gives setup recipes.                                                                              |
| **Windows**                              | —                                  | No reachable equivalent (Windows Hello needs a UWP context). Dispatch from a macOS/Linux host or the GitHub web UI.            |

**MDM detection is filesystem-only.** The hook checks for known
blocker install paths (`/Library/Application Support/iru`,
`/usr/local/jamf/bin/jamf`, `/Library/Mosyle`, `/Library/Kandji`, …)
with `existsSync` — it never invokes osascript to probe, because the
probe itself triggers the block toast.

### Linux setup (one-time)

YubiKey (or any FIDO2 device):

```sh
sudo apt install libpam-u2f          # Debian/Ubuntu
sudo dnf install pam-u2f             # Fedora/RHEL
pamu2fcfg | sudo tee -a /etc/u2f_mappings
# Add to /etc/pam.d/sudo, above `@include common-auth`:
#   auth sufficient pam_u2f.so authfile=/etc/u2f_mappings
```

Laptop fingerprint reader:

```sh
sudo apt install libpam-fprintd fprintd   # Debian/Ubuntu
sudo dnf install fprintd-pam              # Fedora/RHEL
fprintd-enroll
# Add to /etc/pam.d/sudo, above `@include common-auth`:
#   auth sufficient pam_fprintd.so
```

Verify either with `sudo -k && sudo -n true` — a silent exit 0 means
the hook will recognize it as a physical-presence success.

## macOS Touch ID setup (one time, recommended on Sonoma+)

The hook prints these instructions on first use if Touch ID isn't
configured. Run once to enable Touch ID as a sudo auth method (sudo
falls back to the password prompt if Touch ID is unavailable —
declined, no fingerprint enrolled, lid closed):

```sh
sudo tee /etc/pam.d/sudo_local <<'EOF'
auth       sufficient     pam_tid.so
EOF
```

> **Copy-paste verbatim.** The closing `EOF` must start at column 0
> (no leading whitespace) or the heredoc will not terminate and
> your shell will hang waiting for input. Same constraint applies
> to the body lines — they're sent to `tee` as-is. If you indented
> this block when transcribing it, strip the indent.

After this, every bypass-authorized refresh pops a Touch ID dialog
(no password typing required).

### What the command does, line by line

- **`sudo tee /etc/pam.d/sudo_local`** — writes to `/etc/pam.d/sudo_local`, which requires root; `sudo tee` is the canonical "write a file as root from a normal shell" pattern. `tee` reads stdin and writes the file; `sudo` elevates `tee`. Plain `> /etc/pam.d/sudo_local` redirection wouldn't work because the redirect happens in your unprivileged shell BEFORE sudo runs. This first sudo invocation prompts for your password the conventional way (since Touch ID isn't set up yet); every sudo after this point gets the Touch ID option.

- **`/etc/pam.d/sudo_local`** — the official macOS PAM extension point introduced in macOS Sonoma (14). Apple created it so users can layer auth methods on sudo without modifying `/etc/pam.d/sudo`, which is replaced on every macOS update. `/etc/pam.d/sudo`'s first line is `auth include sudo_local`, which pulls in whatever you put here. The file doesn't exist by default; creating it is what activates the extension.

- **`<<'EOF' ... EOF`** — a [heredoc](https://en.wikipedia.org/wiki/Here_document). Everything between the markers becomes stdin for `tee`. The single quotes around the opening `'EOF'` disable shell variable / backtick expansion inside the body — `$foo` and `` ` `` stay literal. Conservative default for config files.

- **`auth       sufficient     pam_tid.so`** — the PAM directive. Three fields:
  - **`auth`** — the module-type. PAM stacks split into `auth`, `account`, `password`, and `session`; only `auth` modules participate in the "prove who you are" phase that sudo cares about.
  - **`sufficient`** — the control flag. PAM evaluates auth modules top-to-bottom; `sufficient` means "if this succeeds, the whole stack succeeds; if it fails, ignore and try the next module". So Touch ID is given first chance, and if you decline the dialog or no fingerprint is enrolled, sudo silently falls through to the password prompt.
  - **`pam_tid.so`** — Apple's Touch ID PAM module shipped at `/usr/lib/pam/pam_tid.so.2`. Pops the system Touch ID dialog and reports success / failure to PAM. Requires Touch ID hardware (M-series MacBook, Touch ID Magic Keyboard, or unlocked Apple Watch).

### Why `sufficient` and not `required`?

The four PAM control flags:

- **`required`** — must succeed; failure recorded but stack keeps evaluating
- **`requisite`** — must succeed; failure short-circuits immediately
- **`sufficient`** — succeeds the whole stack on success; failure ignored, falls through
- **`optional`** — result ignored

We use `sufficient` because Touch ID should be an **alternative** to typing the password, not a precondition. Lid closed, no fingerprint enrolled, declined dialog, broken sensor → sudo silently moves to the password path. No friction, no lockout.

### Why not edit `/etc/pam.d/sudo` directly?

You can; it's a text file. But macOS updates replace it on every system upgrade — your edit silently disappears after the next macOS minor release. `sudo_local` is preserved across upgrades; that's its whole purpose.

### Verifying it works

```sh
sudo -k          # invalidate any cached auth
sudo -v          # next sudo should pop the Touch ID dialog
```

If Touch ID dialog appears → good. If you see a password prompt → Touch ID isn't enrolled, or you're on hardware without Touch ID, or the file path / content is wrong. Re-run the setup and double-check.

### Undoing it

```sh
sudo rm /etc/pam.d/sudo_local
```

Back to default. On a non-MDM Mac the osascript password dialog still
works (slower). On an MDM-managed Mac, removing Touch ID leaves **no**
working path — re-enable it or dispatch from elsewhere.

## Tests

Run `node --test test/index.test.mts` (the `pnpm test` wrapper goes
through a workspace install that currently has unrelated drift).

14 cases cover:

- non-`gh` Bash command → pass
- on-disk storage → block
- keyring storage + non-dispatch `gh` command → pass
- workflow dispatch + no scope → block
- workflow dispatch + scope + unconsumed grant → pass
- workflow dispatch consumes the grant (single-use) → grant deleted
- workflow dispatch + scope + missing grant → block
- workflow dispatch + **attacker-planted grant (wrong session)** → block
- `gh auth refresh -s workflow` + no bypass → block
- `gh auth refresh -s workflow` + bypass → reaches the auth path
  (outcome is environment-dependent; the test asserts it does NOT hit
  the bypass-missing branch)
- `gh auth refresh -r workflow` (revoke) → pass without bypass
- `gh api .../dispatches` (api shape) → block
- token >8h old → block
- token >8h old + `gh auth refresh` → pass (self-recovery)

The OS physical-presence path (Touch ID / pam_u2f / pam_fprintd /
osascript) and the MDM-blocker filesystem detection are **not** unit
tested — they're OS-specific and were removed from the test surface
when the `SOCKET_GH_HYGIENE_TEST_AUTH` override was deleted. Verify
manually on the target machine.
