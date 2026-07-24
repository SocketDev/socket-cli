# codex-session-budget-guard

PreToolUse guard. Codex companion sessions are for **quick checks, not long
sessions**. When the environment carries `CODEX_COMPANION_SESSION_ID`, the guard
stamps a start marker on the companion's first tool call and blocks every tool
call once the wall-clock budget (`BUDGET_MS`, 1 minute) is spent — with a
hand-off message pointing sustained work at a full Claude session.

No-op for any session without the companion env var, so the primary Claude
session and every fleet member are unaffected. Fail-open on IO errors.

- Bypass (user types it in a turn): `Allow codex-long-session bypass`
- Marker store: `node_modules/.cache/fleet/socket-codex-session/<id>.json` (untracked)
- Motivation: a runaway multi-hour companion once looped `land-work`/`cover` and
  monopolized the shared checkout. See CLAUDE.md → parallel-sessions.
