# path-regex-normalize-reminder

Claude Code Stop hook. Inspects code blocks the assistant wrote for regex
literals or `new RegExp(...)` calls that try to match both path separators
inline — patterns like `[/\\]`, `[\\\\/]`, or `\\\\` in a regex that also
mentions path-flavored segments (`.cache`, `node_modules`, `build`, etc.).

Suggests normalizing the path first with `normalizePath` (or `toUnixPath`)
from `@socketsecurity/lib/paths/normalize`, then writing the regex against
`/` only.

## Why

Dual-separator patterns are easy to miss in some branches, slower to read,
and they multiply when escaped Windows separators (`\\\\`) get mixed in.
The fleet's `normalizePath` helper converts backslashes to forward slashes
plus does segment collapsing — one normalized representation across
`darwin` / `linux` / `win32`. Lint rules and runtime code both benefit
from a single-separator regex against normalized input.

## Trigger

The hook is a **reminder**, not a blocker. It writes to stderr at the end
of a turn if it sees a suspect pattern in the last assistant message's
code fences. Exit code is always 0.

## Bypass

Type `Allow path-regex-normalize bypass` verbatim in a recent user turn.
(Reminders don't strictly need bypasses since they don't block; the phrase
is for consistency with other fleet hooks.)

## Disable

Set `SOCKET_PATH_REGEX_NORMALIZE_REMINDER_DISABLED=1` in the env.
