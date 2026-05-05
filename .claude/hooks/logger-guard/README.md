# logger-guard

Claude Code `PreToolUse` hook that blocks `Edit`/`Write` tool calls
introducing direct stream writes (`process.stderr.write`,
`process.stdout.write`, `console.log/error/warn/info/debug`) into
source files.

## Why

Source code uses `getDefaultLogger()` from `@socketsecurity/lib/logger`
for all output. Direct stream writes bypass:

- Color/theme handling
- Indentation tracking
- Stream redirection in tests
- Counter increments used by spinners and progress bars

so they produce inconsistent output that breaks layout-sensitive
workflows (spinner clears, footer rendering).

## Scope

- Only fires on `Edit` / `Write` tools.
- Only inspects files matching `*.{ts,mts,tsx,cts}` under repo
  source. Hooks (`.claude/hooks/`), git-hooks (`.git-hooks/`), build
  scripts (`scripts/`), tests, fixtures, and external/vendored code
  are exempt.
- Lines containing `# socket-hook: allow logger` are exempt
  (canonical opt-out). The bare `# socket-hook: allow` form also
  works.
- Lines that look like documentation (`*` / `//` / `#` comments,
  JSDoc tags, fully-backticked code spans) are exempt.

## Suggested replacements

| Direct call | Logger equivalent |
| --- | --- |
| `process.stderr.write(s)` | `logger.error(s)` |
| `process.stdout.write(s)` | `logger.info(s)` |
| `console.error(...)` | `logger.error(...)` |
| `console.warn(...)` | `logger.warn(...)` |
| `console.info(...)` | `logger.info(...)` |
| `console.debug(...)` | `logger.debug(...)` |
| `console.log(...)` | `logger.info(...)` |

The hook surfaces the rewrite as a `Fix:` line per hit so the agent
can apply it directly.

## Tests

```bash
cd .claude/hooks/logger-guard
node --test test/*.test.mts
```
