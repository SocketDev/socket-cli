# broken-hook-detector

**Lifecycle**: SessionStart

**Purpose**: catch the failure mode where every Bash invocation prints noisy `PreToolUse:Bash hook error … node:internal/modules/package_json_reader:314` lines without identifying which hook crashed or what it needed.

## What it does

At `SessionStart` (once per session — no Bash spam), the hook walks every `.claude/hooks/*/index.mts` plus `.claude/hooks/_shared/*.mts`, spawns `node --check` on each, and aggregates failures. If any crash with `ERR_MODULE_NOT_FOUND`, the hook surfaces a single structured message naming:

- The failing hook
- The missing package(s)
- The exact `pnpm i` recovery command

## Self-imposed constraint: Node built-ins only

This hook is the safety net for "hook deps are broken"; it must not itself depend on anything installed via pnpm. The entire import surface is `node:fs`, `node:path`, `node:child_process`, `node:url`. Adding a `@socketsecurity/*` import here would make the hook silently fail under the exact condition it exists to detect.

## Fail-open

The probe never blocks. On any internal error (timeout, unreadable file, walker exception) the hook exits 0 and the session starts normally. The point is informational diagnosis, not enforcement.

## When it fires in practice

Most often after a wheelhouse cascade introduces a new `import` to a `_shared/*.mts` helper and the consuming repo hasn't run `pnpm install` to materialize the dependency.
