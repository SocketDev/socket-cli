# no-blind-keychain-read-guard

`PreToolUse(Bash)` blocker that refuses direct keychain READ calls
from Bash. The keychain APIs surface a UI auth prompt per call;
reading three times costs three prompts. The fleet's canonical
in-process resolver (`api-token.mts.findApiToken()`) caches the
value module-scoped after the first hit, so subsequent code paths
should never need to re-read the keychain.

## Detected reads

| Platform        | Pattern                                     |
| --------------- | ------------------------------------------- |
| macOS           | `security find-{generic,internet}-password` |
| Linux           | `secret-tool lookup` / `secret-tool search` |
| Windows         | `Get-StoredCredential`                      |
| Windows         | `Get-Credential … \| ConvertFrom-SecureString` |
| cross-platform  | `keyring get`                               |

## Allowed (not flagged)

Writes and deletes — these only happen during operator-driven
setup / rotation, never on hot paths:

- `security add-generic-password` / `security delete-generic-password`
- `secret-tool store` / `secret-tool clear`
- `New-StoredCredential` / `Remove-StoredCredential`
- `keyring set` / `keyring del`

## Bypass

Type the canonical phrase verbatim in your next user turn:

```
Allow blind-keychain-read bypass
```

Use when you genuinely need a fresh keychain read — operator-invoked
diagnostics, verifying an entry exists, etc.

## Why

`security find-generic-password` on macOS prompts the user every call
unless the calling process is on the entry's ACL. Claude Code's Bash
tool spawns a fresh process per call, so each `security` invocation
re-prompts. The same shape exists on Linux (`secret-tool` against
gnome-keyring / kwallet) and Windows (`Get-StoredCredential` against
the CredentialManager UI).

The right answer is to read the cached value from process state:

```ts
import { findApiToken } from '../setup-security-tools/lib/api-token.mts'
const { token } = findApiToken() // module-cached after first call
```

Or from a child process spawned by hooks:

```bash
echo "$SOCKET_API_KEY"   # populated by wheelhouse shell-rc bridge
```

The bridge writes the token to `~/.zshenv` (or platform equivalent)
so every new shell exports `SOCKET_API_KEY` + `SOCKET_API_TOKEN`
without a keychain read.
