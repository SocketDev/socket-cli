# no-experimental-strip-types-guard

PreToolUse Bash hook that blocks commands passing `--experimental-strip-types` to Node.

## Why

The `--experimental-strip-types` flag became:

- **Stable** in Node 22.6 (renamed to `--strip-types`, flag still accepted as alias).
- **Default-on** in Node 24+.

The fleet runs Node 22.6+ everywhere. Passing the flag is dead weight — it's a no-op on every supported runtime, emits a deprecation warning on some, and usually signals a stale copy-pasted invocation that was lifted from a Node 22.0–22.5 era guide.

## What it blocks

| Pattern                                  | Why                                                              |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `node --experimental-strip-types foo.ts` | Strip is stable/default; flag is a no-op.                        |
| `NODE_OPTIONS='--experimental-strip-types' ...` | Same. Captured by the same regex (word-boundary match).    |
| `pnpm exec node --experimental-strip-types ...` | Same.                                                       |

## How

The hook reads the Claude Code PreToolUse JSON payload from stdin, inspects `tool_input.command` for a word-boundary match against `--experimental-strip-types`, and exits 2 (block) with a stderr message identifying the current Node version. Fails open on malformed input (exit 0).

## Bypass

None. If a tool genuinely needs the flag (e.g. you're testing Node behavior on a stale runtime), invoke node directly without going through Bash, or pin a specific older Node version in the script. There is no allowlist — every fleet repo runs Node 22.6+.

## Test

```sh
pnpm test
```
