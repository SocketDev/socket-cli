# `.claude/hooks/_shared/`

Helper modules shared across multiple hooks under `.claude/hooks/`. **Not a deployable hook** — has no `index.mts` entry point and no Claude Code hook lifecycle wiring.

## What lives here

- **`bash-quote-mask.mts`** — Parses a Bash command string and reports the byte ranges that sit inside single-quoted, double-quoted, or heredoc bodies. Used by `no-experimental-strip-types-guard`, `token-guard`, and similar Bash-scanning hooks to skip false positives in literal strings (e.g. `echo "tip: --experimental-strip-types is..."` should not trigger).

- **`hook-env.mts`** — `isHookDisabled(slug)` and `hookLog(slug, ...lines)`. Standardizes the `SOCKET_<UPPER_SLUG>_DISABLED` env-var convention every hook supports plus the `[<slug>] <line>` stderr prefix shape. Use these in new hooks so every hook gets a uniform kill switch + output format for free.

- **`markers.mts`** — Shared sentinel constants for bypass phrases the user can type to override a hook (`Allow <name> bypass`, etc.).

- **`payload.mts`** — `ToolCallPayload` and `ToolInput` types for the PreToolUse JSON payload, plus `readCommand` / `readFilePath` / `readWriteContent` narrowing helpers. **Use this instead of re-declaring `tool_input` types per-hook** — the fleet had 7 hand-rolled variants before this module landed.

- **`stop-reminder.mts`** — `runStopReminder(config)` scaffold for Stop hooks that are pure pattern-sweep over the last assistant turn. Reduces a typical pattern-only hook from 100-200 LOC to ~50. Pass `patterns: [{label, regex, why}, ...]` and `closingHint`; the scaffold handles stdin parse, transcript walk, code-fence strip, per-hit snippet extraction, and stderr emit.

- **`token-patterns.mts`** — Canonical catalog of secret-bearing env-var key names (Socket, LLM providers, GitHub, Linear, Notion, AWS, Stripe, …). Used by `token-guard` (Bash) and `no-token-in-dotenv-guard` (Edit/Write) for the same shape detection.

- **`transcript.mts`** — `readStdin()` for hook payloads, plus `readLastAssistantText()` and `readLastAssistantToolUses()` for walking the Claude Code session transcript JSONL. Tolerates the harness's 3 historical schema variants in one place so a schema bump is a one-file fix.

- **`wheelhouse-root.mts`** — Walks up from `cwd` to find the local `socket-wheelhouse` checkout (used by hooks that need wheelhouse-relative paths, e.g. `new-hook-claude-md-guard`, `drift-check-reminder`).

## When to reach for what (new hook quick-reference)

- Writing a **Stop hook** that just emits a reminder when patterns match? → `import { runStopReminder } from '../_shared/stop-reminder.mts'`. See `comment-tone-reminder` or `excuse-detector` for the shape.

- Writing a **PreToolUse hook** that inspects a tool call's input? → `import { ToolCallPayload, readCommand, readFilePath } from '../_shared/payload.mts'`. Saves you the `typeof === 'string'` guard.

- Reading the Bash command + want to skip false positives inside quoted strings? → `import { containsOutsideQuotes } from '../_shared/bash-quote-mask.mts'`.

- Want a kill switch for your hook? → `import { isHookDisabled, hookLog } from '../_shared/hook-env.mts'`. The hook is enabled by default and `SOCKET_<UPPER_SLUG>_DISABLED=1` opts out — same shape across the fleet.

- Need to scan secret-bearing env-var names? → `import { ALL_TOKEN_KEY_PATTERNS } from '../_shared/token-patterns.mts'`.

## Adding to `_shared/`

A module belongs in `_shared/` when:

1. Two or more hooks under `.claude/hooks/*/index.mts` need the same parsing / matching / IO logic.
2. The logic is self-contained — no Claude Code hook lifecycle (`process.stdin`, exit codes, blocking semantics).
3. Test coverage lives in `_shared/test/` alongside the helper.

If only one hook uses it, keep it inline in that hook's directory. If three or more hooks need it across `.claude/hooks/` AND `.git-hooks/`, escalate it to `_helpers.mts` (the cross-boundary shared module) instead.

## Not a hook

The `audit-claude` script and the sync-scaffolding `every-hook-has-test` check skip `_shared/` because it carries no `index.mts`. Future contributors who add an `index.mts` here are mis-using the directory — the file should live in a sibling `<hook-name>/` directory instead.
