# path-guard

Claude Code `PreToolUse` hook that refuses `Edit`/`Write` tool calls that would *construct* a multi-segment build/output path inline in a `.mts` or `.cts` file. Mandatory across the Socket fleet — every repo ships this file byte-for-byte via `scripts/sync-scaffolding.mjs`.

**Mantra: 1 path, 1 reference.**

Construct a path *once* in the canonical `paths.mts` (or a build-infra helper); reference the computed value everywhere else.

## What it blocks

| Rule | Example | Fix |
|------|---------|-----|
| **A** — Multi-stage path constructed inline | `path.join(PKG, 'build', mode, 'out', 'Final', name)` | Construct in the package's `scripts/paths.mts` (or use `getFinalBinaryPath` from `build-infra/lib/paths`); import the computed value here |
| **B** — Cross-package path traversal | `path.join(PKG, '..', 'lief-builder', 'build', ...)` | Add `lief-builder: workspace:*` as a dep; import its `paths.mts` via the workspace `exports` field |

The hook fires on `Edit` and `Write` tool calls when the target path ends in `.mts` or `.cts`. Other extensions (`.ts`, `.mjs`, `.js`, `.yml`, `.json`, `.md`) pass through — TS path code lives in `.mts` per CLAUDE.md, and other file types are covered by the `scripts/check-paths.mts` gate at commit time.

## What it allows

- Edits to a `paths.mts` (canonical constructor — every package's source of truth).
- Edits to `scripts/check-paths.mts` (the gate, which legitimately enumerates patterns).
- Edits to this hook's own files (the test suite has to enumerate the same patterns).
- Edits to `scripts/check-consistency.mts` (existing path-scanning gate).
- `path.join` calls with a single stage segment (e.g. `path.join(packageRoot, 'build', 'temp')`) — that's a one-off helper path, not a multi-stage build output.
- `path.join` calls with no stage segments at all (most general-purpose joins).
- Any string concatenation that doesn't go through `path.join` — the hook is regex-based and intentionally narrow; the gate runs a deeper scan at commit time.

## Stage segments the hook recognizes

These come from `build-infra/lib/constants.mts` `BUILD_STAGES` plus the lowercase directory-name siblings used by some builders:

`Final`, `Release`, `Stripped`, `Compressed`, `Optimized`, `Synced`, `wasm`, `downloaded`

Two or more in the same `path.join` call (or one stage + one of `'build'`/`'out'` + one mode `'dev'`/`'prod'`) triggers Rule A.

## Known sibling packages (for Rule B)

The hook recognizes Rule B traversals only when the next segment after `..` is a known fleet package name:

`binflate`, `binject`, `binpress`, `bin-infra`, `build-infra`, `codet5-models-builder`, `curl-builder`, `iocraft-builder`, `ink-builder`, `libpq-builder`, `lief-builder`, `minilm-builder`, `models`, `napi-go`, `node-smol-builder`, `onnxruntime-builder`, `opentui-builder`, `stubs-builder`, `ultraviolet-builder`, `yoga-layout-builder`

When a new package joins the workspace, add it here.

## Control flow

The hook reads the tool-use payload from stdin, type-checks `tool_name === 'Edit'` or `'Write'`, filters to `.mts`/`.cts` files, and runs `check(source)`. Any rule violation `throw`s a typed `BlockError`; a single top-level `try/catch` in `main()` writes the block message to stderr and sets `process.exitCode = 2`.

Hook bugs fail **open** — a crash in the hook writes a log line and returns exit 0 so legitimate work isn't blocked on a bad deploy. The companion `scripts/check-paths.mts` gate runs a thorough whole-repo scan at `pnpm check` time, catching anything the hook misses.

## Testing

```bash
pnpm --filter hook-path-guard test
```

Adding a new detection pattern: update `STAGE_SEGMENTS` (or `KNOWN_SIBLING_PACKAGES`) in `index.mts`, add a positive and negative test in `test/path-guard.test.mts`.

## Updating across the fleet

This file is in `IDENTICAL_FILES` in `scripts/sync-scaffolding.mjs` (in `socket-repo-template`). After editing, run from `socket-repo-template`:

```bash
node scripts/sync-scaffolding.mjs --all --fix
```

to propagate the change to every fleet repo.
