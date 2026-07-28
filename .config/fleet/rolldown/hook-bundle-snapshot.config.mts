/**
 * @file Rolldown build for the SNAPSHOT variant of the fleet hook dispatch
 *   bundle. Identical to `hook-bundle.config.mts` except the input is the
 *   snapshot build entry (`dispatch-snapshot-entry.mts`), which registers a
 *   V8 deserialize-main fn instead of running the CLI at module eval, and the
 *   output is `_dispatch/snapshot-bundle.cjs` — the CJS file fed to
 *   `node --build-snapshot`. SPIKE: lives alongside the production config; if
 *   the snapshot path lands, fold the two configs into one parametrized maker.
 */

import path from 'node:path'

import type { RolldownOptions } from 'rolldown'

import {
  DISPATCH_DIR,
  DISPATCH_TABLE_SNAPSHOT_PATH,
} from '../../../scripts/fleet/paths.mts'
import { createLibSnapshotFixPlugin } from './lib-snapshot-fix.mts'
import { createLibStubPlugin } from '../../repo/rolldown/lib-stub.mts'

// Route every `./dispatch-table.mts` import (dispatch.mts + the snapshot
// entry) to the snapshot-SAFE table variant: hooks tagged
// `@dispatch-snapshot-exclude` must not reach the build pass — their
// module-eval graphs hold native [Foreign] handles V8 refuses to serialize
// (CheckGlobalAndEternalHandles fatal). They ship in excluded-bundle.cjs,
// spliced in at runtime by deserialize-main.
function createSnapshotTableAliasPlugin() {
  return {
    name: 'snapshot-table-alias',
    resolveId(source: string, importer: string | undefined) {
      if (
        importer &&
        (source === './dispatch-table.mts' ||
          source.endsWith('/dispatch-table.mts'))
      ) {
        return DISPATCH_TABLE_SNAPSHOT_PATH
      }
      return undefined
    },
  }
}

const config: RolldownOptions = {
  external: [/^node:/],
  input: path.join(DISPATCH_DIR, 'dispatch-snapshot-entry.mts'),
  output: {
    file: path.join(DISPATCH_DIR, 'snapshot-bundle.cjs'),
    // BUILD-PASS-ONLY global shim, prepended before any module-eval. V8's
    // `--build-snapshot` builder context does NOT expose `SharedArrayBuffer` as a
    // global, but `@socketsecurity/lib`'s `primordials/globals.js` captures it
    // (`const SharedArrayBufferCtor = SharedArrayBuffer`) at module-eval for
    // anti-tampering — throwing `SharedArrayBuffer is not defined` and breaking
    // the bundle. The dispatch boot path never constructs a SharedArrayBuffer, so
    // a benign build-time alias, only when genuinely absent, lets the capture
    // succeed without changing any runtime behavior. Gated on
    // `isBuildingSnapshot()` so it is a pure build-pass shim — a deserialized
    // process sees the real global. Mirrors the logger/semver snapshot-only stubs.
    intro:
      'try {' +
      "  if (require('node:v8').startupSnapshot.isBuildingSnapshot()) {" +
      "    if (typeof SharedArrayBuffer === 'undefined') {" +
      '      globalThis.SharedArrayBuffer = ArrayBuffer;' +
      '    }' +
      // BUILD-PASS-ONLY: neutralize node:util.styleText. The vendored
      // @inquirer/core `defaultTheme` (inside external-pack.js) calls
      // `styleText('blue','?')` etc. while building its theme object at
      // module-eval. styleText probes `process.stdout` for TTY color support,
      // and the FIRST access to `process.stdout` lazily constructs the stdout
      // stream (`createWritableStdioStream` → `new net.Socket`) — a native
      // [Foreign] handle V8 refuses to serialize (`global handle not serialized`
      // → `CheckGlobalAndEternalHandles failed`, a fatal native abort). The
      // dispatch boot path never colorizes (guards return verdict DATA; the
      // dispatcher writes plain text), so during the BUILD pass styleText is a
      // passthrough that never touches stdout. A deserialized process sees the
      // real styleText. The cleanest single chokepoint for the whole color
      // graph — far narrower than stubbing every theme/spinner/color module.
      '    try {' +
      "      const util = require('node:util');" +
      "      if (typeof util.styleText === 'function') {" +
      '        util.styleText = (_fmt, text) => String(text);' +
      '      }' +
      '    } catch {}' +
      // BUILD-PASS-ONLY: swallow process warnings. The spawn/inquirer graph
      // requires node:async_hooks / node:tty / node:readline at module-eval,
      // and Node emits a "not yet fully verified ... in user snapshot builder"
      // warning for each. Emitting a warning routes through console.error →
      // process.stderr, and the FIRST process.stderr access lazily constructs
      // the stderr stream (`new net.Socket`) — a native [Foreign] handle V8
      // refuses to serialize (the SAME materialization trap as styleText, via a
      // different door). Silencing the warning keeps stderr untouched during the
      // build. A deserialized process emits warnings normally.
      "    try { process.removeAllListeners('warning'); process.on('warning', () => {}); } catch {}" +
      // BUILD-PASS-ONLY: make node:tty WriteStream.prototype.hasColors() report
      // false. The vendored yoctocolors-cjs probes
      // `require('node:tty').WriteStream.prototype.hasColors()` at module-eval to
      // decide whether to emit ANSI; that probe materializes a tty/stdout stream
      // (a native [Foreign] handle). Forcing false during the build is exactly
      // the module's own `?? false` no-TTY fallback — no color on the dispatch
      // path anyway — and avoids the stream construction. Real process sees the
      // real hasColors.
      '    try {' +
      "      const tty = require('node:tty');" +
      '      if (tty.WriteStream && tty.WriteStream.prototype) {' +
      '        tty.WriteStream.prototype.hasColors = () => false;' +
      '      }' +
      '    } catch {}' +
      '  }' +
      '} catch {}',
    // Force a SINGLE chunk. A bundled hook may use a lazy runtime `import()`
    // (`judgment-nudge` does `await import('compromise')` INSIDE its check fn,
    // never at module-eval) — rolldown's default is to code-split that dynamic
    // import into its own chunk, but `--build-snapshot` consumes ONE CJS file, so
    // a multi-chunk output fails the build (`output.dir must be used, not
    // output.file`). `codeSplitting: false` inlines every dynamic import into the
    // one chunk; the lazily-imported module's eval then runs at module-load (the
    // build pass), so it must itself be snapshot-clean — verified: `compromise`
    // snapshots + boots cleanly here. (Was the deprecated `inlineDynamicImports`.)
    codeSplitting: false,
    format: 'cjs',
    minify: false,
    sourcemap: false,
  },
  platform: 'node',
  plugins: [
    createSnapshotTableAliasPlugin(),
    // SNAPSHOT-ONLY: apply a behavior-preserving lazy transform to the two lib
    // dist modules that construct `new AsyncLocalStorage()` at module-eval
    // (`env/rewire.js` + `themes/context.js`). An AsyncLocalStorage registers a
    // native async-hook [Foreign] handle V8 refuses to serialize; both storages
    // are read only inside function bodies, so deferring the construction to
    // first use is identical behavior and unblocks the env-rewire / theme-context
    // graph (dragged into the full 190-hook bundle, e.g. via check-new-deps). The
    // plugin reads the store source and rewrites just the eager binding — no
    // overlay dir to populate. The real path is the upstream lib release
    // deferring these two constructions + a version bump.
    createLibSnapshotFixPlugin(),
    createLibStubPlugin({
      stubPattern: /@socketsecurity\/lib(?:-stable)?\/.*\/(?:globs|sorts)\.js$/,
    }),
    // SNAPSHOT-ONLY stub: replace the interactive prompts surface with a no-op.
    // `stdio/prompts.js` eagerly imports @inquirer/* at module-eval, which pulls
    // node:readline + node:tty and constructs native [Foreign] handles V8 refuses
    // to serialize. A spawn-graph hook drags prompts in transitively (via the lib
    // barrel), but NO bundled guard's check() ever prompts the user on the
    // dispatch hot path — the dispatcher surfaces verdict DATA itself. Same
    // never-reached rationale as the logger stub; keeps the production bundle's
    // prompts intact while letting the snapshot build.
    createLibStubPlugin({
      stubPattern: /@socketsecurity\/lib(?:-stable)?\/.*\/stdio\/prompts\.js$/,
      stubCode: 'module.exports = new Proxy({}, { get: () => () => {} });',
    }),
    // SNAPSHOT-ONLY stub: replace the default-spinner provider with a no-op
    // spinner. `spinner/default.js` statically pulls the spinner-class graph
    // (spinner.js → create-spinner-class.js → the YoctoSpinner class + the
    // yoctocolors/cli-spinners color machinery), which materializes a native
    // [Foreign] handle at module-eval that V8 refuses to serialize and that
    // resists JS-level deferral (the residual blocker after the spinner /
    // abortSignal / AsyncLocalStorage / signal-exit / yocto-factory deferrals).
    // The spinner is ONLY the default value of `spawn()`'s `spinner` option, and
    // the dispatch hot path NEVER renders a spinner — guards return verdict DATA
    // and the dispatcher writes plain text. So a no-op spinner (the methods
    // spawn() touches: isSpinning / start / stop, all inert) is behavior-safe on
    // the dispatch path. Same never-reached rationale as the logger + prompts
    // stubs; the production bundle keeps the real spinner. This is what unblocks
    // the 56 spawn-graph hooks for bundle A.
    createLibStubPlugin({
      stubPattern:
        /@socketsecurity\/lib(?:-stable)?\/.*\/spinner\/default\.js$/,
      stubCode:
        'const noop = () => {};' +
        'const spinner = { isSpinning: false, start: noop, stop: noop, success: noop, error: noop, info: noop, warn: noop, text: "", color: "" };' +
        'module.exports = { getDefaultSpinner: () => spinner, getCliSpinners: () => ({ __proto__: null }) };',
    }),
    // SNAPSHOT-ONLY stub: replace the shared logger with a no-op. The logger
    // module graph (logger/default → node → symbols → primordials/globals)
    // CAPTURES `SharedArrayBuffer` and touches `node:console`/`node:tty` at
    // module-eval — all absent / snapshot-hostile in V8's `--build-snapshot`
    // builder context — so importing it makes the bundle un-snapshottable.
    // In the dispatch path the logger is NEVER reached: the bundled guards'
    // `check` fns return verdict DATA (block/notify), and the dispatcher
    // surfaces messages itself via process.std{err,out} — `applyGuardResult`
    // / `runGuard`, the only logger consumers, are standalone-entry paths the
    // snapshot deserialize-main never calls. Stubbing it here keeps the
    // PRODUCTION bundle's logger intact while letting the snapshot build.
    createLibStubPlugin({
      stubPattern: /@socketsecurity\/lib(?:-stable)?\/.*\/logger\/default\.js$/,
      stubCode:
        'const noop = () => {};' +
        'const sink = new Proxy({}, { get: () => noop });' +
        'module.exports = { getDefaultLogger: () => sink };',
    }),
    // SNAPSHOT-ONLY stub: neutralize the vendored `semver` (lib's
    // `external/semver.js`, re-exported up through `versions/_internal.js` and
    // `sorts/_internal.js`). semver's `index.js` builds `subset`'s
    // `new Comparator(">=0.0.0-0")` at MODULE-EVAL, and once ROLLDOWN inlines the
    // semver tree into the single CJS chunk the circular `comparator → SemVer`
    // require resolves to an incomplete export, throwing `SemVer is not a
    // constructor` and breaking the bundle. It is dragged in TRANSITIVELY (e.g.
    // `alpha-sort-nudge` → `sorts/natural` → `sorts/_internal.getSemver` → semver)
    // by hooks that only want `naturalCompare`; NO bundled hook calls a semver fn
    // on the boot path. A lazy Proxy keeps the module importable (so the static
    // graph resolves) while deferring any real semver load to first ACCESS — which
    // the deserialize-main never triggers — so no `new Comparator` runs at build.
    // LOAD-BEARING — re-probed 2026-06-27: removing this stub fails the build with
    // `TypeError: SemVer is not a constructor` on Node 22, 24, AND 26 (the inlined
    // circular-require ordering, NOT the isolated `new Comparator` pattern — that
    // alone snapshots fine; it is rolldown's bundled module-init order that breaks).
    createLibStubPlugin({
      stubPattern:
        /@socketsecurity\/lib(?:-stable)?\/.*\/external\/semver\.js$/,
      stubCode:
        'let real;' +
        "const load = () => (real ??= require('semver'));" +
        'const lazy = new Proxy(function () {}, {' +
        '  get: (_t, p) => load()[p],' +
        '  apply: (_t, thisArg, args) => load().apply(thisArg, args),' +
        '  construct: (_t, args) => Reflect.construct(load(), args),' +
        '});' +
        'module.exports = lazy;',
    }),
    // SNAPSHOT-ONLY stub: make `cacache/_internal.js`'s cacache accessor LAZY.
    // The real `_internal.js` does `let src = require('../external/cacache')` at
    // module-eval; the vendored cacache bundle's module-eval constructs a native
    // -backed object (an `[[api object]]` + its `[Foreign]` backing — an LRU /
    // npmcli-fs cache handle) V8 refuses to serialize. `check-new-deps`'s
    // `audit.mts` is the only puller (`cache/ttl/store` → `cacache/{read,write,
    // clear}` → this `_internal`), and it only ever calls `getCacache()` lazily
    // inside `getNotFoundCache()` — never on the snapshot boot path. This stub
    // re-implements the leaf with a `getCacache()` that requires the cacache
    // bundle on FIRST CALL (and `__toESM`-normalizes it the same way), so the
    // cacache module-eval, and its handle, is deferred to runtime. Standalone
    // aube / the production bundle keep the eager `_internal.js`. This is what
    // unblocks check-new-deps for bundle A.
    createLibStubPlugin({
      stubPattern:
        /@socketsecurity\/lib(?:-stable)?\/.*\/cacache\/_internal\.js$/,
      stubCode:
        "const require_runtime = require('../_virtual/_rolldown/runtime.js');" +
        'let cached;' +
        'function getCacache() {' +
        '  if (cached === undefined) {' +
        "    cached = require_runtime.__toESM(require('../external/cacache'));" +
        '  }' +
        '  return cached.default;' +
        '}' +
        'exports.getCacache = getCacache;',
    }),
    // SNAPSHOT-ONLY stub: make `versions/_internal.js`'s resolved `impl` LAZY.
    // The real `_internal.js` binds `const impl = getSmolVersions() ?? semver` at
    // module-eval — on stock Node `getSmolVersions()` is `undefined`, so `impl`
    // IS the vendored semver. `versions/compare.js` then does
    // `const eq = impl.eq.bind(impl)` (and gt/gte/lt/lte/sort/rsort) at ITS
    // module-eval, and `versions/parse.js` does `getSemver().coerce(...)` inside
    // fn bodies. Those module-eval property ACCESSES on `impl` fire the
    // external/semver lazy-Proxy's `load()` → `require('semver')` → semver's
    // module-eval `new Comparator(">=0.0.0-0")` DURING the snapshot build, which
    // breaks it (the same inlined circular-require ordering the external/semver
    // stub note describes). `brew-supply-chain-guard` is the transitive puller
    // (`_shared/brew-supply-chain.mts` → `versions/{compare,parse}`), and it only
    // needs `gte`/`coerceVersion` — never on the snapshot boot path. This stub
    // re-implements `_internal.js` with an `impl` that is a per-property
    // FORWARDING-FUNCTION Proxy: `impl.eq` returns a function (so `.bind(impl)`
    // and `typeof impl.neq === 'function'` work at module-eval) that defers the
    // real impl resolution + semver load to first CALL — which the deserialize
    // -main never makes. `getSemver()` is likewise deferred. Standalone aube /
    // the production bundle keep the real eager `_internal.js`. This is what
    // unblocks brew-supply-chain-guard for bundle A.
    createLibStubPlugin({
      stubPattern:
        /@socketsecurity\/lib(?:-stable)?\/.*\/versions\/_internal\.js$/,
      stubCode:
        "const smol = require('../smol/versions.js');" +
        "const sem = require('../external/semver');" +
        'let resolved;' +
        'const resolve = () => (resolved ??= smol.getSmolVersions() ?? sem);' +
        // Per-property forwarding Proxy: every access returns a function so the
        // module-eval `impl.eq.bind(impl)` + `typeof impl.neq === "function"`
        // checks in compare.js behave as they do against a real impl, while the
        // first CALL is what actually resolves the impl + loads semver. `neq`
        // mirrors compare.js's own `!eq` fallback when the resolved impl lacks
        // it (the vendored semver has no `neq`).
        'const impl = new Proxy({ __proto__: null }, {' +
        '  get: (_t, p) => (...args) => {' +
        '    const r = resolve();' +
        "    if (p === 'neq' && typeof r.neq !== 'function') {" +
        '      return !r.eq(...args);' +
        '    }' +
        '    return r[p](...args);' +
        '  },' +
        '  has: (_t, p) => p in resolve(),' +
        '});' +
        'exports.getSemver = () => sem;' +
        'exports.impl = impl;',
    }),
  ],
}

export default config
