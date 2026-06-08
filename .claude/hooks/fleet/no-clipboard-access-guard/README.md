# no-clipboard-access-guard

`PreToolUse(Bash | Edit | Write)` blocker that refuses clipboard access from a
script, hook, or Bash command. The system clipboard is a cross-process exfil +
overwrite surface: a secret copied there leaks to every app, and an OSC-52
escape written to the terminal can silently overwrite (or, on permissive
terminals, read) it. Fleet tooling never needs the clipboard, so any attempt is
a mistake or a poisoning fingerprint.

## Detected

| Surface     | Pattern                                                          |
| ----------- | --------------------------------------------------------------- |
| Bash        | `pbcopy` / `pbpaste` (macOS)                                     |
| Bash        | `xclip` / `xsel` / `wl-copy` / `wl-paste` (Linux)               |
| Bash        | `clip` / `clip.exe` (Windows)                                   |
| Edit /Write | source emitting an OSC-52 escape (`ESC ] 52 ;`, any spelling)   |

Bash detection is AST-parsed via the fleet shell parser (`findInvocation`), not
a loose regex, so a path fragment or quoted literal doesn't false-fire. The
OSC-52 match covers the raw ESC byte and the `\x1b` / `\033` / `` / `\e`
escaped spellings.

## Bypass

Type the canonical phrase verbatim in your next user turn:

```
Allow clipboard-access bypass
```

Use only for a genuine, operator-driven clipboard need (rare).

## Why

The terminal "attempted to access the clipboard but it was denied" banner comes
from an OSC-52 escape reaching the emulator. The denial is the safe default; this
hook stops fleet code from emitting one (or shelling out to a clipboard CLI) in
the first place, so the attempt never happens rather than relying on the
terminal to refuse it.
