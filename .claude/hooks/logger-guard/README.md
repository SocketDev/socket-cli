# logger-guard

A **Claude Code hook** that runs before `Edit` or `Write` tool calls
on TypeScript source files and **blocks** edits that introduce direct
stream writes — `process.stderr.write`, `process.stdout.write`,
`console.log` / `error` / `warn` / `info` / `debug` — into source
code that's supposed to use a logger.

> If you haven't worked with Claude Code hooks before: hooks are tiny
> scripts that run at specific lifecycle points. A `PreToolUse` hook
> like this one fires *before* Claude calls a tool. It can either
> **prime** (write to stderr, exit 0, model carries on) or **block**
> (exit 2, edit never happens). This one blocks.

## Why a logger and not console.log

Source code in this fleet uses `getDefaultLogger()` from
`@socketsecurity/lib/logger` for all output. That logger handles:

- **Color and theme.** Terminal colors honor the user's environment
  (no-color, light/dark, etc.). Direct `console.log` doesn't.
- **Indentation tracking.** Nested operations indent their output.
  Direct writes don't, so you get unaligned messages.
- **Stream redirection in tests.** Vitest captures and asserts on
  logger output. Direct writes go to the real stdout/stderr and
  pollute test reports.
- **Layout-sensitive features.** Spinners, progress bars, and footer
  rendering all increment counters the logger maintains. Bypassing
  the logger leaves those counters wrong, which produces visual
  artifacts (a spinner that doesn't clear, a footer that
  duplicates).

The block is what keeps the logger as the single source of truth.
If even one file directly writes to stdout, the next person on a
related file sees the precedent and follows it; the convention
erodes.

## Scope

The hook is intentionally narrow:

- **Fires** on `Edit` and `Write` calls.
- **Inspects** files matching `*.{ts,mts,tsx,cts}` under repo source.
- **Exempts** `.claude/hooks/`, `.git-hooks/`, `scripts/`, tests,
  fixtures, and external/vendored code — those have legitimate
  reasons to write directly.
- **Exempts** lines tagged `# socket-hook: allow logger` (canonical
  per-line opt-out). The bare form `# socket-hook: allow` also
  works for blanket suppression.
- **Exempts** lines that look like documentation: lines starting
  with `*`, `//`, or `#`; JSDoc tags; fully-backticked code spans.

## Suggested replacements

When the hook blocks, it surfaces a concrete rewrite per hit so the
agent can apply it directly:

| Direct call | Logger equivalent |
|-------------|-------------------|
| `process.stderr.write(s)` | `logger.error(s)` |
| `process.stdout.write(s)` | `logger.info(s)` |
| `console.error(...)` | `logger.error(...)` |
| `console.warn(...)` | `logger.warn(...)` |
| `console.info(...)` | `logger.info(...)` |
| `console.debug(...)` | `logger.debug(...)` |
| `console.log(...)` | `logger.info(...)` |

## Wiring

`.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/logger-guard/index.mts"
          }
        ]
      }
    ]
  }
}
```

## Testing

```bash
cd .claude/hooks/logger-guard
node --test test/*.test.mts
```

## Cross-fleet sync

This README and the hook itself live in
[`socket-repo-template`](https://github.com/SocketDev/socket-repo-template/tree/main/template/.claude/hooks/logger-guard)
and are required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.
