# path-guard

A **Claude Code hook** that runs before `Edit` or `Write` tool calls
on `.mts` or `.cts` files and **blocks** edits that would build a
multi-segment build/output path inline. The fleet's rule, in one
sentence:

> 1 path, 1 reference. Construct a path *once* in a canonical
> `paths.mts` (or a build-infra helper); reference the computed value
> everywhere else.

> If you haven't worked with Claude Code hooks before: hooks are tiny
> scripts that run at specific lifecycle points. A `PreToolUse` hook
> like this one fires *before* Claude calls a tool. It can either
> **prime** (write to stderr, exit 0, model carries on) or **block**
> (exit 2, edit never happens). This one blocks.

## Why this rule exists

Build outputs typically nest deep — `build/<mode>/<platform>/out/Final/<bin>`.
If three different scripts all `path.join(...)` their own version of
that path, a refactor that changes the layout breaks one or two of
them silently. Centralizing the construction in a single `paths.mts`
per package means a refactor is a one-file diff, and divergence
becomes impossible because every consumer imports the same value.

The companion `scripts/check-paths.mts` runs a deeper whole-repo
scan at `pnpm check` time, catching anything this hook missed.

## What it blocks

| Rule | Example that gets blocked | Fix |
|------|--------------------------|-----|
| **A** — multi-stage path constructed inline | `path.join(PKG, 'build', mode, 'out', 'Final', name)` | Move the construction into the package's `scripts/paths.mts` (or use `getFinalBinaryPath` from `build-infra/lib/paths`); import the computed value here. |
| **B** — cross-package path traversal | `path.join(PKG, '..', 'lief-builder', 'build', ...)` | Add `lief-builder: workspace:*` as a dependency; import its `paths.mts` via the workspace `exports` field. |

The hook fires on `Edit` and `Write` tool calls when the target path
ends in `.mts` or `.cts`. Other extensions (`.ts`, `.mjs`, `.js`,
`.yml`, `.json`, `.md`) pass through — TS path code lives in `.mts`
per fleet convention, and other file types are covered by the
`scripts/check-paths.mts` gate at commit time.

## What it allows

- Edits to a `paths.mts` (the canonical constructor).
- Edits to `scripts/check-paths.mts` (the gate itself, which
  legitimately enumerates patterns).
- Edits to this hook's own files (the test suite has to enumerate
  the same patterns).
- `path.join` calls with a single stage segment, e.g.
  `path.join(packageRoot, 'build', 'temp')` — that's a one-off
  helper path, not a multi-stage build output.
- `path.join` calls with no stage segments at all (most
  general-purpose joins).
- Any string concatenation that doesn't go through `path.join` —
  the hook is regex-based and intentionally narrow.

## Stage segments the hook recognizes

These come from `build-infra/lib/constants.mts:BUILD_STAGES` plus the
lowercase directory-name siblings used by some builders:

`Final`, `Release`, `Stripped`, `Compressed`, `Optimized`, `Synced`,
`wasm`, `downloaded`

Two or more in the same `path.join` call — or one stage segment plus
one of `'build'`/`'out'` plus one mode (`'dev'`/`'prod'`) — triggers
Rule A.

## Known sibling packages (for Rule B)

The hook recognizes Rule B traversals only when the next segment
after `..` is a known fleet package name:

`binflate`, `binject`, `binpress`, `bin-infra`, `build-infra`,
`codet5-models-builder`, `curl-builder`, `iocraft-builder`,
`ink-builder`, `libpq-builder`, `lief-builder`, `minilm-builder`,
`models`, `napi-go`, `node-smol-builder`, `onnxruntime-builder`,
`opentui-builder`, `stubs-builder`, `ultraviolet-builder`,
`yoga-layout-builder`

When a new package joins the workspace, add it to
`KNOWN_SIBLING_PACKAGES` in `index.mts`.

## Fail-open on hook bugs

If the hook itself crashes, it writes a log line and exits `0` —
i.e. *the edit is allowed*. A buggy security hook that blocks
everything is worse than one that temporarily lets things through.
The companion `scripts/check-paths.mts` gate at commit time catches
anything the hook missed.

## Testing

```bash
pnpm --filter hook-path-guard test
```

Adding a new detection pattern: update `STAGE_SEGMENTS` (or
`KNOWN_SIBLING_PACKAGES`) in `index.mts`, then add a positive and a
negative test in `test/path-guard.test.mts`.

## Cross-fleet sync

This README and the hook itself live in
[`socket-repo-template`](https://github.com/SocketDev/socket-repo-template/tree/main/template/.claude/hooks/path-guard)
and are required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.

To propagate a change from the template to every fleet repo:

```bash
node scripts/sync-scaffolding.mts --all --fix
```
