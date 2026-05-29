# gh token hygiene

GitHub CLI auth tokens are the highest-blast-radius credential most developers carry. The Nx Console supply-chain compromise (May 2026) exfiltrated `~/.config/gh/hosts.yml` and used the token against the GitHub API within 74 seconds of malware execution. Three layered defenses, all enforced by `.claude/hooks/fleet/gh-token-hygiene-guard/` (the 8h age cap, keychain check, and workflow-scope gate all live in this hook — `auth-rotation-reminder` handles non-gh CLIs like npm/pnpm/gcloud/docker/vault).

## 1. Keychain storage only

`gh` 2.40+ defaults to writing the token to the OS keychain, but older installs (and any account where `--insecure-storage` was passed) keep a `gho_…` token in `~/.config/gh/hosts.yml`. Any process running as the user can read that file. The fix:

```bash
gh auth logout
gh auth login              # keychain is the default (no flag needed)
gh auth status             # confirms "(keyring)"
```

(There is no `--secure-storage` flag; the only knob is the opt-out `--insecure-storage`, which this hook rejects.)

The hook reads `gh auth status` output. If the storage backend is not `keyring`, the hook rejects any `gh` invocation with stderr explaining the fix. No bypass. Moving the token off disk is non-negotiable.

The keychain isn't impenetrable (any process invoking `gh auth token` can still pull it), but it converts the most likely exfiltration path (direct file read) into a much harder one (subprocess invocation through an auth-prompting wrapper on macOS, libsecret on Linux, Credential Manager on Windows). That's the qualitative win.

## 2. `workflow` scope is off by default

`gh auth login` defaults to granting `repo, workflow, gist, admin:public_key, admin:repo_hook`. A sledgehammer. The fleet trims to `read:org, repo, gist` (gh forces `gist` as a minimum and refuses to remove it):

```bash
gh auth refresh -h github.com -r workflow,admin:public_key,admin:repo_hook
```

The hook blocks `gh workflow run`, `gh workflow dispatch`, and `gh api .../actions/workflows/.../dispatches`. The flow is **strictly single-use AND requires physical presence**:

1. Need to dispatch? Type `Allow workflow-scope bypass` in chat.
2. Run `gh auth refresh -h github.com -s workflow`. The hook then requires OS-level authentication:
   - **Touch ID** if `pam_tid.so` is in `/etc/pam.d/sudo_local` (recommended setup; see below)
   - **Password dialog** via `osascript` validated against your user account, otherwise
3. On successful auth, the hook records `~/.claude/gh-workflow-grant`. Run ONE dispatch.
4. The hook deletes the grant file immediately after letting the dispatch through.
5. To dispatch again: revoke (`gh auth refresh -h github.com -r workflow`), type a fresh bypass phrase, refresh-add again, re-authenticate.

The chat bypass phrase alone is insufficient. An attacker who exfiltrates the chat-typed slot still can't proceed without your physical presence (Touch ID or typed password). The single most-dangerous capability (dispatching workflows that have access to all repo secrets including npm publish tokens) is gated by an explicit per-use physical-presence check.

### Touch ID setup (one-time, recommended on macOS Sonoma+)

```sh
sudo tee /etc/pam.d/sudo_local <<'EOF'
auth       sufficient     pam_tid.so
EOF
```

> **Copy-paste verbatim.** The closing `EOF` must start at column 0 (no leading whitespace), or the heredoc never terminates and your shell hangs waiting for input. The body lines (`auth ... pam_tid.so`) get written to `tee` as-is. If you indented this block when transcribing it, strip the indent before running.

After this, every bypass-authorized refresh pops a Touch ID dialog. No password typing.

> **MDM-managed machines (iru / Jamf / Mosyle / Kandji):** the osascript password-dialog fallback is typically blocked by org policy ("Process Blocked: osascript"). On these boxes Touch ID is the **only** working physical-presence path. The hook detects the block via a cheap headless probe and skips the dialog automatically (no toast spam); the error message points back to this Touch ID setup. If your Mac doesn't have Touch ID hardware AND your org blocks osascript, the workflow-scope path is effectively closed — flag that with IT or use a non-MDM machine for releases.

#### What the command does, line by line

- **`sudo tee /etc/pam.d/sudo_local`**: writes to `/etc/pam.d/sudo_local`, which requires root privileges. `sudo tee` is the canonical pattern for "write a file as root from a normal shell". `tee` reads stdin and writes it to the file; `sudo` elevates `tee` so it can write into `/etc/pam.d/`. (Plain shell redirection `> /etc/pam.d/sudo_local` wouldn't work; the redirection happens in your unprivileged shell BEFORE sudo runs.) The very first `sudo` invocation here is the bootstrap one. Touch ID isn't configured yet, so this one prompts for your password the conventional way. Every sudo invocation after this point gets the Touch ID option.

- **`/etc/pam.d/sudo_local`**: the official macOS extension point for sudo PAM configuration, introduced in macOS Sonoma (14). Apple created it so users can layer auth methods on sudo without modifying `/etc/pam.d/sudo` (which is replaced on every macOS update). The main `/etc/pam.d/sudo` file's first line is `auth include sudo_local`, which pulls in whatever you put here. The file doesn't exist by default; creating it is what enables the extension.

- **`<<'EOF' ... EOF`**: a [heredoc](https://en.wikipedia.org/wiki/Here_document). Everything between the two `EOF` markers becomes stdin for `tee`. The single quotes around the first `'EOF'` disable shell variable / backtick expansion inside the body. `$foo` and ` `` ` ` ` stay literal. Conservative default for config files.

- **`auth       sufficient     pam_tid.so`**: the PAM directive. Three space-separated fields:
  - **`auth`**: the module-type. PAM stacks are split into `auth`, `account`, `password`, and `session`; only `auth` modules participate in the "prove who you are" phase that sudo cares about.
  - **`sufficient`**: the control flag. PAM evaluates auth modules top-to-bottom; `sufficient` means "if this module succeeds, the whole stack succeeds and stop here; if it fails, ignore and try the next module". So Touch ID is given first chance, and if you decline the dialog or no fingerprint is enrolled, sudo falls through to the password prompt that comes from the main `sudo` stack.
  - **`pam_tid.so`**: the Touch ID PAM module Apple ships in `/usr/lib/pam/pam_tid.so.2`. It pops the standard macOS Touch ID dialog and reports success/failure back to PAM. Requires a Mac with Touch ID hardware (M1+ MacBook, MagSafe-connected Touch ID keyboard on desktops, or Apple Watch on supported models).

#### Why `sufficient` and not `required` or `requisite`?

The four PAM control flags, briefly:

- **`required`**: must succeed; failure is recorded but the stack keeps going so an attacker can't probe which module failed
- **`requisite`**: must succeed; failure short-circuits the stack immediately
- **`sufficient`**: succeeds the whole stack on success; failure is ignored and falls through to the next module
- **`optional`**: result is ignored

We pick `sufficient` because we want Touch ID to be an alternative to password entry, not a precondition. If Touch ID isn't available (lid closed, no enrolled fingerprint, declined dialog, broken sensor), sudo silently moves on to the password path. No friction, no lockout.

#### Why not edit `/etc/pam.d/sudo` directly?

You can. `/etc/pam.d/sudo` is just a text file. But macOS updates replace it on every system upgrade, so your edit would silently disappear after the next macOS minor release. `sudo_local` is preserved across upgrades. That's its whole reason for existing.

#### Verifying it worked

```sh
# Reset the sudo timestamp so it can't cache a previous auth
sudo -k
# This sudo invocation should pop the Touch ID dialog
sudo -v
```

If you see the Touch ID dialog, you're good. If you see a password prompt instead, either:

- Touch ID isn't enrolled on this Mac: check System Settings → Touch ID & Password
- You're on a Mac without Touch ID hardware: use the password fallback (the hook handles this automatically)
- The file path or content is wrong: re-run the `sudo tee` command and double-check

#### Undoing it

```sh
sudo rm /etc/pam.d/sudo_local
```

After this, sudo is back to its default (password only). The hook's auth flow will still work via the osascript password dialog path.

## 3. 8-hour token age cap

`auth-rotation-reminder` Stop-hook tracks the gh token's issued-at timestamp (stored at `~/.claude/gh-token-issued-at`). When the token is >8 hours old, the next Stop event exits non-zero with instructions:

```
gh auth refresh -h github.com
```

8 hours is the workday boundary: one re-auth at session start, no in-flight interruption. Shorter cadences (1h, 4h) were considered and rejected. The Nx malware exfiltrated and exercised the token in 74 seconds, so any rotation cadence above "instantaneous" is the same qualitative defense. 8h minimizes friction while keeping the steal window bounded.

Local timestamp tracking is advisory. A malicious process can backdate the file. Real defense comes from the OTHER layers in this doc, not the rotation cadence.

## What this doesn't defend against

- **Already-running malware with current token.** The token is already in keychain memory. Rotation matters for the next exfil; the current breach is mitigated by signed-commit enforcement, branch protection, and audit-log alerting (see _Wave 2_ in `.claude/plans/gh-token-hygiene-hook.md`).
- **Phished OAuth flows.** A user typing credentials into a malicious login page bypasses every local defense. Phishing-resistant MFA (WebAuthn / passkeys) is the answer; the fleet doesn't enforce that here.
- **Compromised dependencies pulling tokens via gh subprocess.** A malicious npm package can `spawn('gh', ['auth', 'token'])` and exfiltrate. The defense is supply-chain review (Socket scanning + minimumReleaseAge + checked deps).

## Recovery flow if a token leaks

1. **Revoke immediately** at https://github.com/settings/tokens (search "gh" or the token name, click Delete).
2. Audit recent activity: https://github.com/settings/security-log
3. Check repo audit logs for unauthorized pushes / workflow dispatches / PRs.
4. If anything looks wrong: rotate every repo's deploy keys, deploy tokens, and CI secrets accessible from the affected token's scope.
5. Re-issue gh token with keychain storage + minimal scopes (`gh auth logout && gh auth login` — keychain is the default; then trim scopes via `gh auth refresh -h github.com -r workflow,admin:public_key,admin:repo_hook`).
6. File an incident note in the relevant repo's SECURITY log.

## Operational defaults

- `~/.claude/gh-token-issued-at`: local timestamp stamped by the hook when the user runs `gh auth login` or `gh auth refresh`. The 8h age check reads this.
- `~/.claude/gh-workflow-grant`: presence marker for an unconsumed workflow-dispatch authorization. Created when a bypass-authorized + auth-passed `gh auth refresh -s workflow` runs; deleted as soon as the first dispatch is let through.

## Refresh recovery — when the hook didn't see your refresh

The hook stamps `~/.claude/gh-token-issued-at` from a `PreToolUse` event — meaning it only sees `gh auth refresh` invocations that pass through Claude's tool layer. If you ran `gh auth refresh` in a side terminal (e.g. via the `<bash-input>` pasteback flow), the hook didn't see it and the stamp file stays at its prior age, so the next gh tool call gets the >8h block.

Three recovery paths, ordered from cleanest to most surgical:

1. **Run the refresh through Claude.** Ask Claude to run `gh auth refresh -h github.com` in a Bash tool call. The hook sees it, pre-stamps, and the next gh call goes through.
2. **Use the hook's `--stamp` CLI mode.** From any shell:
   ```sh
   node ~/.claude/hooks/fleet/gh-token-hygiene-guard/index.mts --stamp
   ```
   Writes a fresh `Date.now()` to the stamp file. Use this when you've already done `gh auth refresh` externally and don't want to re-run it.
3. **Auto-correction of malformed values.** If the stamp file contains a value less than `1577836800000` (2020-01-01 in ms) — e.g. you accidentally wrote POSIX seconds via `date "+%s" > ~/.claude/gh-token-issued-at` — the hook treats it as malformed on the next read, re-stamps, and proceeds. No manual intervention required; the malformed-value branch is there as a safety net for cases like the seconds-vs-ms confusion (2026-05-28 incident).

The stamp file is purely an in-process record of "when did the hook last see a refresh"; the actual token security lives in the OS keychain. A wrong stamp value can't escalate access — at worst it temporarily locks the user out of gh tool calls until they reauth or re-stamp.

No escape hatches. The hook is failsafe-deny on all invariants. The OS-auth path (Touch ID + osascript + dscl, called via absolute `/usr/bin/` paths to defeat PATH-hijack) is intentionally unreachable in unit tests; the auth path is exercised by manual smoke-testing when the hook ships.
