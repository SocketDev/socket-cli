# prefer-fff-search-nudge

PreToolUse(`Bash`, `Grep`) **nudge** (non-blocking) — steers repo search toward
the [fff](https://github.com/dmtrKovalenko/fff) MCP tools instead of ripgrep/grep.

## What it does

Fires when the agent reaches for ripgrep/grep to search the repo:

- the built-in **`Grep`** tool, or
- a bash **`rg`** / **`ripgrep`** invocation, or a recursive **`grep -r`** / `--recursive`.

It emits a one-line reminder to use fff's `ffgrep` (content), `fffind` (paths),
or `fff-multi-grep` — a resident, frecency-ranked, git-aware index (sub-10ms vs
3-9s per ripgrep spawn on a large tree) wired in `.mcp.json` (`fff-mcp`, installed
by `setup-tools`). Rationale lives in `docs/agents.md/fleet/tooling.md`.

A bare `… | grep foo` pipe-filter of another command's output is **not** a repo
search and is left alone (parser-backed via `findInvocation`, so a quoted `"rg"`
or a path containing `grep` never trips it).

## Why a nudge, not a block

`ripgrep`/`grep` stay valid for scripts and one-off shell use, and fff's MCP
tools aren't loaded in every client/session — a hard block would strand a search.
So this only reminds. It fails open on any error.

## Config

- `SOCKET_FFF_NUDGE_INTERVAL_HOURS` — throttle window (default `2`). A
  search-heavy session gets one reminder, not a flood. `0` = nudge every time.

State: `~/.claude/hooks/prefer-fff-search/last-nudge` (mtime = last nudge).
