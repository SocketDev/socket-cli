# codex-no-write-guard

PreToolUse Bash hook that blocks `codex` CLI invocations with code-change
intent. Fleet-wide: only fires when `codex` appears in a command, so it's
a no-op in repos that don't use Codex.

## Why

Dense perf-critical code (parser internals, native bindings) is sensitive
to subtle edits. Codex output is excellent for diagnosis and review but
tends to introduce micro-regressions when used to generate code changes.
The 5ms inline-asm-prefetch incident is the canonical example.

The rule: use Codex for advice; do the edits yourself based on the advice.

## What it blocks

| Pattern                                                            | Block? |
| ------------------------------------------------------------------ | ------ |
| `codex --write ...` / `codex -w ...`                               | yes    |
| `codex "implement X" ...` / `codex "add Y" ...` / etc.             | yes    |
| `codex "explain X"` / `codex "diagnose Y"` / `codex "review"`      | no     |

## Bypass

Type the canonical phrase in a new message:

    Allow codex-write bypass

Use sparingly — the regression risk is real.

## Wiring

Wired into the fleet's default `template/.claude/settings.json` PreToolUse
chain. The hook short-circuits to exit 0 unless `codex` appears in the
command, so it costs ~nothing in repos that never invoke Codex.
