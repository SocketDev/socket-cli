# V8 startup-snapshot hook dispatcher — SINGLE-BUNDLE (190/190) notes

Status: **full coverage in ONE frozen bundle — the hybrid is retired.** This
documents the `spike/snapshot-hooks` experiment after the last 10 hooks (the
prior bundle-B remainder) were made snapshot-safe and migrated into the frozen
snapshot. The dispatcher now runs as a SINGLE **bundle A** — a V8 startup
snapshot holding **all 190 candidate hooks**. There is no bundle B and no
runtime `loadBundleB()` splice anymore; the frozen `dispatch()` runs the whole
set. Built + boots + byte-equivalent to the live per-hook path on Node 22, 24,
26 (snapshot == cold dispatch.mts == compile-cache index.cjs).

## Migrating the last 10 — the prior hybrid remainder — into the frozen bundle

The 10 that previously could not freeze — 8 acorn-WASM guards + check-new-deps
(SDK) + brew-supply-chain-guard (semver) — are now all snapshot-safe via lazy
deferral of the module-eval native-handle captures:

1. **8 acorn-WASM guards.** `_shared/acorn/acorn-sync.mts` no longer requires the
   vendored `acorn-bindgen.cjs` at module-eval — the require (hence the WASM
   instantiation) is DEFERRED to first parse. `acorn-bindgen.cjs` ALSO defers its
   own `new WebAssembly.Module/Instance` to first property access of `wasm` (a
   lazy holder + getter) and resolves `acorn.wasm` via a bundling-robust path
   (`FLEET_ACORN_WASM_PATH` override → `path.join(__dirname, 'acorn.wasm')`). The
   build copies `acorn-bindgen.cjs` + `acorn.wasm` next to the bundle (rolldown
   leaves the bindgen require external), so the snapshot-booted process resolves
   them from the frozen bundle dir. Confirmed: a frozen acorn guard instantiates
   the WASM at deserialize-time and parses an AST correctly post-deserialize.
   (The bindgen edit is a refresh-clobbered PROTOTYPE; the permanent home is the
   ultrathink wasm-bindgen GENERATOR — a follow-up.)
2. **check-new-deps (SDK).** The `@socketsecurity/sdk` barrel registers native
   async-hook + HTTP/abort/timer `[Foreign]` handles at module-eval (its inlined
   `env/rewire` + `themes/context` build `new AsyncLocalStorage()`, plus the
   `new SocketSdk()` client). A static `import` forced the bundler to eval the SDK
   barrel on the build pass; the SDK is now loaded via a runtime
   `await import('@socketsecurity/sdk-stable')` inside `getSdk()` (the same lazy
   pattern judgment-nudge uses for compromise). Its `audit.mts` also dragged in
   the vendored cacache, whose module-eval constructs an `[[api object]]` +
   `[Foreign]`; the snapshot config now stubs `cacache/_internal.js` so the
   cacache require is deferred to first `getCacache()` call. Confirmed: the lazy
   SDK import materializes the client + runs `checkMalware` at runtime.
3. **brew-supply-chain-guard (semver).** Reaches `versions/{compare,parse}`, whose
   `_internal.js` binds `impl = … ?? semver` and `compare.js` does
   `impl.eq.bind(impl)` at module-eval — those accesses loaded the vendored semver
   (whose `new Comparator(...)` at eval breaks the build). The snapshot config now
   stubs `versions/_internal.js` with a lazy per-property forwarding `impl` Proxy
   (semver loads on first CALL, never on the boot path).

The lib-side AsyncLocalStorage deferral (`env/rewire.js` + `themes/context.js`)
is a behavior-preserving in-memory transform applied by `lib-snapshot-fix.mts`
(reads the store source, rewrites just the eager `new AsyncLocalStorage()` into a
first-use getter). The semver + cacache deferrals are snapshot-config stubs.

## The lib fix: fb669ee8 was necessary but NOT sufficient

The prior state was 124/190 because the maker auto-excluded the 57-hook
spawn-graph: `@socketsecurity/lib`'s `process/spawn/child.js` captured the default
SPINNER at module-eval. socket-lib commit **fb669ee8** made that spinner lazy.
Probing the full 180-hook `--build-snapshot` proved fb669ee8 fixes ONE class but
the lib pervasively captures OTHER native `[Foreign]` handles at module-eval that
fb669ee8 did not touch. Full set found + deferred for the snapshot build:

1. **eager default SPINNER** — `child.js`, `prompts.js` (the fb669ee8 class).
2. **eager shared ABORTSIGNAL** — `const abortSignal = getAbortSignal()` at
   module-eval in 7 dist files (`process/spawn/child.js`, `stdio/prompts.js`,
   `fs/read-file.js`, `fs/find.js`, `packages/manifest.js`, `packages/tarball.js`,
   `promises/_internal.js`). Each an independent handle. Deferred into the fn body.
3. **eager ASYNCLOCALSTORAGE** — `new AsyncLocalStorage()` at module-eval in
   `env/rewire.js` + `themes/context.js`. Made lazy.
4. **eager SIGNAL-EXIT** — `new SignalExit(process)` in the vendored
   `external/external-pack.js` (pulled via yoctocolors). Deferred.
5. **eager YOCTO-SPINNER** factory eval (`require_yocto_spinner()` at line 405 of
   `external/@socketregistry/yocto-spinner.js`). Deferred.
6. **residual spinner-color graph** — `spinner/default.js` statically pulls the
   spinner-class + cli-spinners/color machinery that materializes a native handle
   resisting JS-level deferral; no-op-stubbed in the snapshot bundle (never
   rendered on the dispatch path).
7. **build-pass shims** (not lib edits) for `node:util.styleText` (it probes
   `process.stdout` → materializes the stdout socket) + `node:tty`
   WriteStream.prototype.hasColors + process `warning` emission (each materializes
   a stdio stream → handle).

The lib-side deferrals (1–5) live in a fixed lib DIST OVERLAY served at build time
by `.config/repo/rolldown/lib-snapshot-fix.mts` (the real path is the upstream lib
release + a version bump); the stub + build-pass shims (6–7) live in the snapshot
rolldown config. With all of it, the spawn graph is snapshot-clean and the 57
spawn hooks join bundle A.

## Coverage: 190 / 190 in ONE frozen bundle

| bundle | count | how it runs | contents |
| --- | --- | --- | --- |
| A (frozen snapshot) | **190** | V8 `--snapshot-blob` deserialize-main | EVERY candidate hook |
| ~~B (runtime-loaded)~~ | 0 | retired | — |

The prior bundle-B 10 (8 acorn-WASM + check-new-deps + brew-supply-chain-guard)
are now snapshot-safe and frozen into bundle A — see the migration section
above. No hook carries `@dispatch-snapshot-exclude`; nothing is irreducible.

## Wiring — single bundle: the hybrid `loadBundleB` is gone

The snapshot entry's `deserializeMain()` no longer splices a second bundle: every
hook is in the frozen `DISPATCH_TABLE`, so the entry just reads the event arg,
drains stdin, JSON.parses, and runs the frozen `dispatch()`. The `loadBundleB()`
function, the `bundle-b.cjs` require, the `registerRuntimeHooks` injection, and
the `hook-bundle-b.config.mts` build are all retired.

The one build-step carry-over: rolldown leaves the acorn bindgen's
`createRequire(...)('./acorn-bindgen.cjs')` external (not inlined), so the build
copies `acorn-bindgen.cjs` + `acorn.wasm` next to the bundle (gitignored; source
of truth `_shared/acorn/`). A snapshot-booted process resolves the bindgen via
the bundled createRequire — its anchor `__filename` freezes to the bundle dir —
and the lazy bindgen reads `acorn.wasm` from `path.join(__dirname, 'acorn.wasm')`
— both resolve to the frozen `_dispatch/` dir.

### Historical context (pre-hybrid, 124/190)

The 66 then-excluded hooks split into three structural buckets:

| bucket | count | why excluded | now |
| --- | --- | --- | --- |
| eligible (bundled) | 124 | snapshot-clean module-eval graph | → 180 (A) |
| acorn-WASM | 8 | WASM parser instantiated at module-eval | → bundle B |
| lib spawn-graph | 57 | native `[Foreign]` handle at module-eval | → bundle A (lib fixed) |
| explicit marker | 1→2 | eager `new SocketSdk()` / semver `[Foreign]` | → bundle B |

What the two completed steps added vs the prior 97-hook state:

- **Codemod completion (`await runHook` → `void runHook`): +27 hooks** (97 → 124).
  The maker fails SAFE — a hook whose standalone entry is still top-level
  `await runHook(...)` is silently dropped because rolldown cannot emit a
  top-level `await` to the CJS snapshot output format. Converting the last 27
  eligible hooks (`runGuard` signals its verdict via `process.exitCode`, a side
  effect — so dropping the `await` is behavior-preserving) made them bundleable.
  This also required `codeSplitting: false` on **both** rolldown configs:
  `judgment-nudge`'s lazy `await import('compromise')` (inside its check fn, never
  at module-eval) is code-split by default, and both the snapshot bundle
  (`--build-snapshot` consumes one CJS file) and the production bundle
  (`index.cjs` `require()`s one `bundle.cjs`) need a single chunk.

- **Semver "over-exclusion" drop: NOT removed — proven load-bearing.** Step 2
  asked to drop the `new Comparator at module-eval` exclusion (the config's
  lazy-`semver` Proxy stub) on the premise that the isolated pattern snapshots
  cleanly. Re-probed: removing the stub fails `--build-snapshot` with
  `TypeError: SemVer is not a constructor` on Node **22, 24, AND 26**. The
  isolated `new Comparator` pattern is fine — but once rolldown INLINES the semver
  tree into the single chunk (`codeSplitting: false`), the circular
  `comparator → SemVer` require resolves to an incomplete export under the
  bundled module-init order, and that is what breaks. So the exclusion is
  load-bearing and was kept; the stub defers the (never-called-on-the-hot-path)
  semver load to first access. `alpha-sort-nudge` is the transitive puller (it
  deep-imports `sorts/natural`, which pulls `external/semver.js`, for
  `naturalCompare` only).

## Irreducible exclusions: NONE — and where the permanent fixes belong

There are no irreducible exclusions left. WebAssembly **can** be instantiated at
deserialize-time (runtime), and a native `[Foreign]` / `[[api object]]` handle
**cannot** be serialized into the blob — so the rule is simply "no native handle
may be captured at module-eval." Every former blocker turned out to be a deferral
problem, not a structural one: the handle was constructed eagerly at import but
only USED inside function bodies, so moving the construction to first use is
behavior-preserving and lets the module freeze. All 190 hooks now satisfy this.

What stays a PROTOTYPE in this worktree vs the permanent home:

1. **acorn bindgen lazy-WASM** (`acorn-bindgen.cjs`) is a refresh-clobbered
   GENERATED artifact (per `paths.mts:VENDORED_ACORN_FILES`) — the worktree edit
   is a prototype. The permanent home is the ultrathink wasm-bindgen GENERATOR:
   it must (i) defer `new WebAssembly.*` to first call and (ii) resolve
   `acorn.wasm` via a bundling-robust path, not eager `__dirname`. (The
   `acorn-sync.mts` deferral is hand-written, not refresh-clobbered, so it stays.)
2. **lib AsyncLocalStorage / semver / cacache deferrals** ride a build-time
   transform (`lib-snapshot-fix.mts`) + snapshot-config stubs against the
   read-only `@socketsecurity/lib` store copy. The permanent home is the upstream
   lib release deferring those module-eval constructions (`env/rewire` +
   `themes/context` AsyncLocalStorage; `versions/_internal` impl; `cacache/_internal`
   accessor), after which the stubs + transform retire and the store copy is
   already snapshot-clean.
3. **SDK lazy import** (`check-new-deps`) is a real hook edit (a runtime
   `await import`), no prototype caveat. A cleaner upstream would lazy-construct
   the SDK client + defer its inlined lib AsyncLocalStorage, but the dynamic
   import already fully defers the barrel, so no upstream change is required for
   the snapshot to work.

## Build / boot / equivalence at full coverage

Built with each Node major — the blob is Node-major + platform + V8-tag keyed:

- **Build:** `node scripts/fleet/build-hook-snapshot.mts` succeeds on 22, 24, 26
  (only the benign `node:module` builder warning).
- **Boot:** each blob deserializes and runs an event end-to-end.
- **Equivalence:** 6/6 fixtures **byte-equivalent** (stdout + stderr + exit) across
  `snapshot blob == cold dispatch.mts == compile-cache index.cjs`, on all three
  Node majors. Fixtures cover PreToolUse Bash (clean / `cd` nudge / commit-format
  block → exit 2), PreToolUse Edit, PreToolUse Write, PostToolUse Edit.

Blob sizes (Node 24): snapshot-bundle.cjs 1.67 MB → blob ~10.9 MB. The
`compromise` inline (`judgment-nudge`) is most of the bundle growth over the
97-hook state.

## Full-coverage perf table vs compile-cache (PreToolUse Edit, warm; hyperfine
`--warmup 8`, ≥50 runs)

**Node 24:**

| variant | mean ± σ | vs compile-cache | processes |
| --- | --- | --- | --- |
| snapshot-direct | 53.5 ± 3.0 ms | **0.88× (faster)** | 1 |
| compile-cache (`index.cjs`) | 60.6 ± 2.1 ms | 1.00× | 1 |
| snapshot-loader | 84.9 ± 3.9 ms | 1.40× (slower) | 2 |
| cold dispatch.mts | 216.6 ± 5.0 ms | 3.57× (slower) | 1 |

**Node 22:**

| variant | mean ± σ | vs compile-cache | processes |
| --- | --- | --- | --- |
| snapshot-direct | 47.3 ± 3.3 ms | **0.78× (faster)** | 1 |
| compile-cache (`index.cjs`) | 60.9 ms | 1.00× | 1 |
| snapshot-loader | 74.3 ± 3.3 ms | 1.22× (slower) | 2 |
| cold dispatch.mts | 224.2 ± 4.9 ms | 3.68× (slower) | 1 |

## The native launcher — recovering the two-process tax

The only deployable snapshot invocation was `snapshot-loader.cjs`: it boots a
FULL node solely to `spawnSync` a SECOND `node --snapshot-blob …`, and that
parent-node startup is the whole ~30 ms the loader loses to snapshot-direct (the
two-process row above). `dispatch-launcher.c` removes it: a ~30-SLOC compiled
binary (`cc -O2`, no deps) that does the re-exec in ONE process transition —
`execv` REPLACES the launcher image with node, so there is no parent node, no
fork, no wait, no second resident process. (`snapshot-loader.cjs`, the prior
two-process loader, is kept only as a reference of the path the launcher
supersedes — it is no longer wired anywhere.)

It resolves the fast path from two build-time-FROZEN sidecars written next to it
(`build-snapshot-launcher.mts`), mirroring `dispatch-snapshot-entry.mts`'s
DISPATCH_DIR_FROZEN model: `node.path` — the node that built the blob — and
`snapshot-blob.path` (the content-keyed blob). Reading a frozen line beats
re-deriving the node-ver × arch × v8tag × uid × content-hash key in C and keeps
the launcher ~null-cost. Fail-open is total — a missing/blank sidecar, a vanished
blob, or any error falls open to `node index.cjs <Event>`, the always-correct
compile-cache path (same fail-open target `snapshot-loader.cjs` uses).

**FAIL-OPEN COVERAGE — now FULL, the hybrid caveat is retired:** with all 190
hooks in the single frozen bundle, `index.cjs` requires `bundle.cjs` = **the same
full 190-hook set** the snapshot freezes (both compile from `dispatch-table.mts`
via `dispatch-entry.mts` → `runDispatcherCli`). So a launcher fail-open to
`node index.cjs <Event>` now runs the COMPLETE guard set — there is no longer a
"10 B-hooks absent on fail-open" gap — the prior hybrid's `bundle-b.cjs` is gone.
The launcher's fail-open target is fully equivalent to the fast path. (Confirmed:
`snapshot blob == index.cjs == live _shared/dispatch.mts`, all 190 hooks, every
fixture below, on Node 22 / 24 / 26.)

### Launcher overhead (measured, macOS arm64, Node 24.12.0, hyperfine)

Isolating the launcher's INTRINSIC cost (self-locate + two sidecar reads + stat +
execv) by pointing it at `/usr/bin/true`:

| variant | mean ± σ |
| --- | --- |
| launcher → true (self-locate + 2 sidecars + execv) | 9.6 ± 1.7 ms |
| bare execv → true: a C `execv` and nothing else | 8.2 ± 2.2 ms |
| `/usr/bin/true` (no exec hop) | 3.8 ± 1.2 ms |

So the launcher adds **~1.4 ms** over a bare `execv` — under the ≤2 ms target.
(The ~4 ms execv→bare gap is hyperfine's per-iteration fork cost, common to every
exec'ing variant — not the launcher.)

Full-dispatcher startup (clean-Bash fixture, end-to-end), Node 24.12.0:

| variant | mean ± σ | vs snapshot-direct | processes |
| --- | --- | --- | --- |
| snapshot-direct (`node --snapshot-blob`, the ceiling) | 131.2 ± 11.9 ms | 1.00× | 1 |
| **native-launcher** | **134.1 ± 11.7 ms** | **1.02× (≈ ceiling)** | 1 |
| sh-launcher floor (`#!/bin/sh; exec node …`) | 147.8 ± 12.3 ms | ~1.13× | 1 |
| snapshot-loader (two-process) | 163.8 ± 2.4 ms | 1.25× (slower) | 2 |

The native launcher lands in the noise of snapshot-direct and beats the
two-process loader by ~30 ms (1.25×) — i.e. it recovers essentially all of the
two-process tax, which was the point of the delivery.

### Equivalence through the DEPLOYABLE path

The single frozen bundle is byte-identical (stdout + stderr + exit) to the live
`_shared/dispatch.mts` AND to the compile-cache `index.cjs`, on fixtures that
exercise each formerly-irreducible class. Re-verified 2026-06-27 across Node 22
(22.21.1), 24 (24.12.0), 26 (26.3.1): **snapshot blob == live dispatch.mts ==
index.cjs, all PASS**, on five fixtures spanning:

- an **acorn-WASM** AST guard, two ways: `pointer-comment-nudge` (the
  pointer-comment fixture — its comment-block walk parses the edit via the
  vendored acorn-wasm, confirming the WASM instantiates + parses an AST
  POST-deserialize from the frozen module → a `notify`), and
  `options-param-naming-guard` — an `opts`-named param → `block`, exit 2;
- the **SDK** hook `check-new-deps` (the lazy `await import('@socketsecurity/
  sdk-stable')` path; offline allow-path fixture, hook present + runs identically);
- the **semver** hook `brew-supply-chain-guard` — verified BOTH branches: an allow
  on a hardened machine, and (with the `HOMEBREW_*` knobs unset) the unhardened
  **block** path, which runs the deferred-semver `gte()`/`coerceVersion()` from the
  frozen module and emits the block message, byte-identical across all three paths;
- a **spawn-graph** guard `prefer-async-spawn-guard` (an Edit importing
  `node:child_process` → `block`, exit 2 — exactly the spawn graph deferred to make
  the bundle snapshot-clean).

(The native launcher is the actual shippable POSIX path; it re-execs the same
`node --snapshot-blob <blob> <Event>` the blob row above measures, so its output
equals the snapshot-direct column.)

## How it's wired — two layers (cascaded baseline + per-machine fast path)

The full coverage moved the verdict for the SHIPPABLE path: once the snapshot is
reached via the native execv launcher (not the retired two-process loader), the
single-process snapshot path beats compile-cache (mac arm64 1.24×, native
linux-arm64 1.31×, linux-x64 1.36×). But Claude Code invokes a fixed
`<command> <Event>` per event and cannot set a per-event process flag, and the
launcher binary is per-os/arch + per-runtime (built per machine, gitignored), so
the wiring is TWO layers:

1. **The cascaded, fleet-canonical baseline — `settings.json` → `node
   ".../index.cjs" <Event>`.** The V8 COMPILE-CACHE path. `index.cjs` requires
   `bundle.cjs` = the COMPLETE 190-hook set (same `dispatch-table.mts` the
   snapshot freezes), so it is correct on every os/arch — Windows included — with
   zero per-machine state. This is what ships to every fleet repo, and it is the
   launcher's own fail-open target, so the worst case anywhere is this complete,
   correct path.

2. **The per-machine fast path — build-on-setup wires the native launcher.** The
   setup step `scripts/fleet/setup/hook-snapshot.mts` (run by `pnpm setup-all` /
   `node scripts/fleet/setup/index.mts`) builds `bundle.cjs`/`index.cjs`, the
   snapshot blob, and the host launcher, then ON POSIX rewrites the LIVE
   `.claude/settings.json` dispatch commands to the launcher binary
   (`"$CLAUDE_PROJECT_DIR"/.claude/hooks/fleet/_dispatch/dispatch-launcher
   <Event>`). The launcher execs `node --snapshot-blob <blob> <Event>` in one
   process transition and FAILS OPEN to `node index.cjs <Event>` on
   missing/blank sidecar, vanished/mismatched blob, or any error — so the wired
   fast path is byte-equivalent to the baseline and never less correct.

   The launcher command is per-machine state the FLEET cascade does not know
   about: a cascade rewrites `settings.json` to `merge(template, repo-hooks)`,
   reverting the dispatch commands to the compile-cache baseline. That revert is
   SAFE (lands on the complete, correct baseline) — re-run the setup step after a
   cascade to restore the launcher fast path. Re-running with it already wired is
   a no-op.

**WINDOWS.** The Windows launcher (`dispatch-launcher-win.c`) has no
image-replacing execv: it `CreateProcess`es node + waits, keeping a thin native
parent resident. Whether that still beats the single-process compile-cache path
is CI-confirm-only. So the setup step builds the `.exe` but, by DEFAULT, LEAVES
Windows on the compile-cache baseline; pass `--win-launcher` to wire the `.exe`
once Windows CI confirms the win. Correctness is identical either way via
fail-open.

## Provisioning — local setup + the CI image-bake

- **Local dev — the warm win after setup:** `pnpm setup-all` builds the blob +
  the host launcher and wires the live settings (POSIX). The blob is
  node-major × arch × V8-tag keyed (~18–21 MB/platform), lives in `os.tmpdir()`,
  and is NEVER committed — it is built per environment.
- **CI / ephemeral / cold containers — the cold 1.5× win:** bake the blob into
  the container IMAGE LAYER once, so a cold/ephemeral runner boots from a
  pre-built blob without paying the build. Build it into the image as a layer
  step keyed to the image's node:

  ```dockerfile
  # In the image build, after node + the repo are present:
  RUN node scripts/fleet/build-hook-bundle.mts \
   && node scripts/fleet/build-hook-snapshot.mts \
   && node scripts/fleet/build-snapshot-launcher.mts
  # The launcher fails open to node index.cjs if the blob is absent, so a base
  # image WITHOUT this step is still correct — it just runs the compile-cache path.
  ```

  Because the launcher's fail-open is total, baking the blob is a pure
  optimization: an image that omits it (or whose baked blob mismatches the
  runtime node) lands on the complete compile-cache baseline.

## Reproduce / verify

```sh
node scripts/fleet/make-hook-dispatch.mts          # regen the 190-hook table
node scripts/fleet/build-hook-bundle.mts           # build the compile-cache bundle.cjs (index.cjs requires it)
node scripts/fleet/build-hook-snapshot.mts         # build snapshot-bundle.cjs + the runtime-keyed blob
node scripts/fleet/build-snapshot-launcher.mts     # compile the host launcher + freeze its sidecars
node scripts/fleet/setup/hook-snapshot.mts         # build all of the above + wire the live settings (POSIX)
```

Equivalence + bench harnesses are throwaway (`/tmp/wh-fix/`), not committed: a
per-fixture spawn of the launcher (fast path) vs `node index.cjs <Event>`
(compile-cache fail-open) vs `node _shared/dispatch.mts <Event>` (the live
dispatcher), diffing stdout/stderr/exit; then the blob ABSENT to confirm the
launcher fails open to `node index.cjs` byte-equivalently.

## Provenance

- V8 startup-snapshot API + the `--snapshot-blob` / `--build-snapshot` flags:
  https://nodejs.org/docs/latest-v24.x/api/v8.html#startup-snapshot-api
- The snapshot-blob cache path mirrors Node's compile-cache key derivation —
  see `snapshot-cache-path.cjs`, which cites
  `https://github.com/nodejs/node/blob/v26.4.0/src/compile_cache.cc#L28-L59`.
- `[Foreign]`-handle / `WebAssembly is not defined` builder constraints: observed
  empirically on Node v22.21.1, v24.14.1, v26.3.1 — the errors above are verbatim.
