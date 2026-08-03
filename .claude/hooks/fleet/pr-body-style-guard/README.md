# pr-body-style-guard

PreToolUse (Bash) hook that enforces the operator's standing write-up contract on GitHub PR/issue bodies (`gh pr create|edit`, `gh issue create|edit`).

## Why

The operator had to re-teach the same write-up contract session after session ("again write at a junior dev level, use `<details>`, point to existing npm behavior, use full sentences — why do I have to keep repeating myself", 2026-07-29, pnpm/pnpm#13479). A rule that has to be repeated is a rule that isn't codified. This hook encodes it mechanically so no future session needs reminding.

The contract:

1. Written for a junior dev to follow without prior context.
2. Full sentences throughout — no fragment-bullet shorthand.
3. Depth (test evidence, implementation notes) behind `<details>` blocks.
4. Cite the existing/precedent behavior the change aligns with.

Plus: when the target repo mandates agent disclosure (e.g. pnpm's AGENTS.md), the mandated footer must be present.

## What it does

On a `gh pr|issue create|edit` that writes a body (`--body <text>`, `--body=<text>`, `--body-file <path>` — the file is read for its content):

- **Clean body** → the contract as a non-blocking reminder (exit 0 + stderr).
- **Deterministic violation** → **BLOCK** (exit 2) naming the exact violation and fix:
  - a body longer than ~25 lines with zero `<details>` blocks;
  - a fragment-heavy body: among non-empty prose lines (code fences, tables, headings, and pure-markup lines excluded; a list item's content counts as prose), fewer than half end in sentence punctuation (`.` `?` `!` `:`).
- **No `--body`/`--body-file` on a `create`** → warn-only reminder: the body will come from the interactive editor, which cannot be inspected, and the message says so. An unreadable `--body-file` (stdin `-`, missing file) is treated the same way.

An `edit` that carries no body flag (e.g. title-only) is not a body write and stays silent. Detection is AST-based (the fleet `shell-command` parser), so quoting, `&&` chains, and `$(…)` are handled and a quoted "gh pr create" inside another command's string cannot false-fire. Not convention-scoped: the contract follows the operator into foreign repos — the motivating incident was a PR opened against pnpm.

## Bypass

`Allow pr-body-style bypass` — auto-wired via `defineHook` metadata, so the phrase the block message shows is provably the phrase the detector accepts, and the exception lands in the guard-event log.
