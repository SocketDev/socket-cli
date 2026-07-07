---
name: creating-guards
description: How to author or convert a fleet PreToolUse / PostToolUse / Stop hook guard to the uniform contract (export const check + block/notify/undefined verdict + runGuard), so the per-event dispatcher runs it in ONE process instead of spawning a node process per guard. Loads on demand when adding a `.claude/hooks/fleet/<name>/` guard or converting an old one.
model: claude-haiku-4-5
context: fork
user-invocable: false
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
---

# creating-guards

**Rule:** a guard is a pure function that RETURNS a verdict — it never calls `process.exit` and never runs logic at import top level beyond one `runGuard(check)`. That contract is what lets the per-event dispatcher (`_shared/dispatch.mts`) import every guard for an event into ONE node process (one `@socketsecurity/lib-stable` import) instead of paying a node cold-start + lib import per guard on every tool call.

## The contract (`_shared/guard.mts`)

```ts
import { block, notify, bashGuard, runGuard } from '../_shared/guard.mts'
// editGuard for Edit/Write/MultiEdit hooks; both if it handles both.

export const check = bashGuard((command, payload) => {
  if (<not applicable>) { return undefined }   // allow, silent
  if (<bypass present>) { return undefined }
  return block(`[my-guard] Blocked: …\n  Fix: …`)  // or notify(…)
})

await runGuard(check)
```

Three verdicts — pick by intended behavior:

- `block(message)` — prints `message` to stderr **and** sets exitCode 2 (Claude Code blocks the tool call). Use for a `-guard`.
- `notify(message)` — prints to stderr, exit 0 (the tool call proceeds). Use for a `-nudge` / `-nudge`.
- `undefined` — allow, silent.

## Shape by event

- **Bash** hook → `export const check = bashGuard((command, payload) => …)`
- **Edit/Write/MultiEdit** hook → `export const check = editGuard((filePath, content, payload) => …)`
- **Stop** hook (no tool_name/command/file) → `export const check = (payload) => …` (no adapter; read `payload.transcript_path` etc.)
- Always end with exactly one top-level `await runGuard(check)`.

## Hard rules (enforced by `socket/guard-contract`)

- ZERO `process.exit(...)` — a hard exit in a shared dispatcher kills the loop and silently skips every later guard.
- ZERO `process.argv[1]` entrypoint gates — they misfire when the dispatcher imports the module.
- No bespoke `process.stdin` reader — read the payload only through the harness / `readPayload`.
- `export const check` + one `await runGuard(check)`. Unit tests import `check` and call it directly (no spawning).

## Not a guard?

A pure side-effect hook (output transformer, installer, sweeper) with no block and no user-facing message does NOT fit the verdict contract — leave it as its own spawned command and skip the conversion.

## Wire-up

Registration is generated: `node scripts/fleet/make-hook-dispatch.mts` classifies every guard and moves contract-conformant ones into `_shared/dispatch-manifest.json` (dispatched) — non-conformant ones stay spawned. Run it after adding/converting a guard; `--check` (in `check --all`) fails when the wiring is stale.
