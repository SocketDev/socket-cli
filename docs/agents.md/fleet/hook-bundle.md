# hook-bundle

Faster warm dispatch for import-safe fleet hooks via a CJS rolldown bundle plus a V8 compile-cache loader. Hook sources stay `.mts`.

## Layout

- `scripts/fleet/gen/hook-dispatch.mts` is the maker. It scans `.claude/hooks/fleet/` for hooks that are both import-safe (entrypoint-guarded) and export a `run(payload)` entry, then writes `.claude/hooks/fleet/_shared/dispatch-table.mts`. That file is a STATIC table of `path` to `thunk` (one static `import()` per hook) that rolldown can see and bundle. A dynamic `import(path.join(HOOKS_DIR, rel))` can't be statically bundled, so the static table is what makes the dispatcher bundle-able.
- `scripts/fleet/build-hook-bundle.mts` plus `.config/fleet/rolldown/hook-bundle.config.mts` is the build. Rolldown bundles the dispatcher, the generated table, every referenced hook, `_shared/`, and only the used slices of `@socketsecurity/lib-stable` into `.claude/hooks/fleet/_dist/fleet-pack.cjs`. Output is CJS format, NOT minified and with no source maps (fleet hard rule - a minified hook bundle is unauditable, and rolldown's minifier is young; enforced by `socket/no-minified-bundler-output`), no `.d.ts`, tree-shaken, and heavy unreachable lib subgraphs stubbed via `createLibStubPlugin`.
- `.claude/hooks/fleet/index.cjs` is the hand-written thin loader (plain CJS, NOT bundled). It calls `require('node:module').enableCompileCache(<repo>/.cache/fleet/fleet-hooks)` then `require('./fleet-pack.cjs')`, forwarding the event arg (`process.argv[2]`).
- `.claude/hooks/fleet/_shared/dispatch-hook.mts` is the dispatcher. It reads the event arg and stdin once, runs the trigger pre-flight, looks up the matching hooks in the static table, and runs each hook's exported `run(payload)` with early-exit on the first blocking decision.

## Why CJS, not type-stripped `.mts`

V8's compile cache (`module.enableCompileCache`) reliably caches and auto-flushes plain CJS modules on normal process exit. A type-stripped `.mts` dispatcher did NOT auto-flush. A normal exit left ZERO cache files on disk, so every spawn recompiled from scratch. Emitting a plain CJS bundle is the core rationale. The loader stays CJS, the bundle is CJS, and the compile cache actually persists between spawns.

## Edit pipeline (order is load-bearing)

1. Edit the hook source in `template/` (never the cascaded copy).
2. Rebuild the dispatch table + bundle (`scripts/fleet/gen/hook-dispatch.mts`, then
   `build-hook-bundle.mts`) so the built artifact matches the sources.
3. Run the unit tests against the rebuilt state.
4. Dogfood the BUNDLE into the wheelhouse's own live `.claude/` and verify
   the dispatcher behavior end-to-end (a synthetic payload through
   `index.cjs`).
5. If the payload ships via a GitHub release, cut that first; THEN cascade
   commits to fleet members for the files a release does not carry.

Building before dogfooding is what keeps a stale `fleet-pack.cjs` from being
distributed: the sync ships whatever bundle exists, so a bundle built from
pre-edit sources propagates silently and the sources-vs-bundle drift only
surfaces when a member's dispatcher misbehaves.

## What the bundle does and does NOT speed up

Most of a cold hook spawn (~1s) is Node STARTUP (process create plus runtime init), with an idle baseline near 100ms. That is fixed cost the bundle and cache cannot touch. The compile cache only removes module-COMPILE time on warm spawns. The real process-count win comes from collapsing many per-hook `node` spawns into one dispatcher spawn per event. The bundle plus cache is the secondary compile-time win on top. Do not overclaim a blanket "Nx faster hook" number.

## Bundled-set scope (gated seam)

Only hooks that are entrypoint-guarded (`import.meta.url` matches `process.argv[1]`) and export a `run(payload)`/`check(payload)` are eligible. Importing them must not fire `main()` and must not call `process.exit()`, which would tear down the shared dispatcher for every hook. The maker skips the rest. `settings.json` routes each hook event (`PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`) to one `index.cjs <Event>` invocation, and the dispatcher runs every bundle-safe hook for that event from the static table. Non-bundle-safe hooks keep their own standalone `settings.json` entries. Note: that's a hook that self-`exit()`s or isn't entrypoint-guarded, for example `broken-hook-detector` or `setup-security-tools`. A `PreToolUse`/`PostToolUse` block surfaces via exit code 2; a `Stop` block uses the stdout-JSON decision protocol (`DispatchResult.decision`).

For `PreToolUse`/`PostToolUse` the event's coarse `settings.json` matcher is a regex prefilter - Claude Code only spawns the dispatcher when the tool matches it, then the dispatcher does an exact per-hook `tools` match. A tool a bundled hook declares but the coarse matcher omits never reaches the dispatcher, so `dispatch-matchers-cover-hook-tools` asserts every bundled hook's `tools` is covered by its event's matcher.

## Single-hook addressing (`fleet-dispatch-single-hook-v1`)

`index.cjs <Event> <hook-name>` narrows the dispatch to the ONE table entry with that name. The wheelhouse's user-global dispatcher, canonical copy `scripts/repo/user-global/wheelhouse-dispatch.mts`, installed to `~/.claude/hooks/wheelhouse-dispatch.mts`, uses this to run a single named hook through the self-contained bundle from ANY repo session, so a concurrent `pnpm install` purge window in the wheelhouse's live node_modules cannot crash session hooks. Contract: a name with no entry in the event's table exits `SINGLE_HOOK_NOT_FOUND_EXIT` (3) so the caller falls back to the hook's source `.mts`; the `SINGLE_HOOK_PROTOCOL` literal is embedded in the built bundle, and callers MUST probe the bundle bytes for it before passing argv[3] - an older bundle ignores the extra arg and runs the whole event's set. In-repo `settings.json` never passes argv[3]; event-wide dispatch is unchanged.

## Staleness reminder

`bundle-stale-reminder` (PostToolUse, Edit|Write) fires after an edit to the dispatcher, the dispatch table, a bundled hook source, or `_shared/`, and reminds you to rebuild. It never blocks. Rebuild with:

```sh
node scripts/fleet/build-hook-bundle.mts
```

The bypass phrase is registered in `docs/agents.md/fleet/bypass-phrases.md` under the `hook-bundle-current` row (the canonical-phrase grammar).

## Proving the compile cache

`test/repo/integration/hook-bundle-compile-cache.test.mts` (vitest) builds the bundle, spawns the `.cjs` loader for an event, then asserts the compile-cache dir is populated under `<cache>/<v8-version>/` (cache files greater than 0). Without that file count the cache claim is unproven, so the test is the gate on the whole feature.

## Enforcement

`.claude/hooks/fleet/bundle-stale-reminder/` (PostToolUse, Edit|Write) fires after an edit to the dispatcher, the dispatch table, a bundled hook source, or `_shared/`, and reminds you to rebuild with `node scripts/fleet/build-hook-bundle.mts`. Non-blocking.
