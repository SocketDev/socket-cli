/**
 * @file Rolldown build for the fleet hook dispatch bundle. Bundles the
 *   dispatcher entry (`_dispatch/dispatch-entry.mts`), the generated static
 *   dispatch table, every bundle-safe hook it imports, the `_shared/` helpers,
 *   and only the reachable slices of `@socketsecurity/lib-stable` into a single
 *   CJS `_dispatch/bundle.cjs`. Lives under `.config/fleet/rolldown/`
 *   (mandatory tier), not `.config/repo/rolldown/` (opt-in tier):
 *   `scripts/fleet/build-hook-bundle.mts` is a mandatory `scripts/fleet` script
 *   every fleet repo carries, so it needs this config unconditionally —
 *   cascading it opt-in left members unable to resolve the rolldown entry.
 *   Output is CJS (not type-stripped ESM .mts) on purpose: V8's compile cache
 *   reliably caches AND auto-flushes plain CJS, so the hand-written `index.cjs`
 *   loader's `enableCompileCache` actually persists between spawns. Not
 *   minified (fleet hard rule), no source maps, no `.d.ts`. node: built-ins
 *   stay external (the bundle runs under Node, which has them). Heavy
 *   unreachable lib subgraphs are stubbed via the fleet-canonical
 *   `createLibStubPlugin`.
 */

import type { RolldownOptions } from 'rolldown'

import {
  DISPATCH_ENTRY_PATH,
  resolveHookBundleOut,
} from '../../../scripts/fleet/paths.mts'
// createLibStubPlugin stays under the opt-in `.config/repo/rolldown/` tier
// (shared with hook-bundle-snapshot.config.mts and the trimming-bundle skill);
// only this config's OWN location is mandatory-tier.
import { createLibStubPlugin } from '../../repo/rolldown/lib-stub.mts'

// 1 path, 1 reference: the dispatch entry + bundle output are constructed once
// in make-hook-dispatch.mts (resolveHookBundleOut honors FLEET_HOOK_BUNDLE_OUT
// so the freshness test can target an isolated os.tmpdir). Never reconstruct
// them here.
const config: RolldownOptions = {
  // node: built-ins are provided by the runtime; never bundle them.
  external: [/^node:/],
  input: DISPATCH_ENTRY_PATH,
  output: {
    // Force a SINGLE chunk. A bundled hook may use a lazy runtime `import()`
    // (`judgment-nudge` does `await import('compromise')` inside its check fn) —
    // rolldown's default code-splits that into a second chunk, but `index.cjs`
    // requires ONE `bundle.cjs`, so a multi-chunk output fails the build
    // (`output.dir must be used, not output.file`). `codeSplitting: false` inlines
    // every dynamic import into the one chunk. (The compile-cache path eval's at
    // require time, not snapshot-build, so the inlined module just loads normally.)
    codeSplitting: false,
    file: resolveHookBundleOut(),
    format: 'cjs',
    // Fleet hard rule: never minify rolldown output and never emit source maps.
    // A minified hook bundle is unauditable — you can't read what actually runs
    // in this security-sensitive surface — and rolldown's minifier is young.
    // Enforced fleet-wide by `socket/no-minified-bundler-output`.
    minify: false,
    sourcemap: false,
  },
  platform: 'node',
  plugins: [
    // Drop heavy `@socketsecurity/lib-stable` subgraphs the dispatch surface
    // never reaches. The hook bundle only touches the logger, the spawn
    // wrappers, and small string/path helpers; the glob (picomatch) and sort
    // (semver + npm-pack) subgraphs are statically reachable but never run.
    // Verify reachability before widening this pattern.
    createLibStubPlugin({
      // Matches @socketsecurity/lib or lib-stable imports ending in /globs.js or /sorts.js.
      stubPattern: /@socketsecurity\/lib(?:-stable)?\/.*\/(?:globs|sorts)\.js$/,
    }),
    // Lazy-`semver` stub (mirrors the snapshot config). `alpha-sort-nudge` deep-
    // imports `sorts/natural` (NOT the `sorts.js` barrel the stub above catches),
    // which transitively pulls `external/semver.js`; semver's `index.js` builds
    // `new Comparator(">=0.0.0-0")` at module-eval, and once `codeSplitting: false`
    // INLINES the semver tree into the one chunk the circular `comparator → SemVer`
    // require resolves to an incomplete export — `TypeError: SemVer is not a
    // constructor` at `require('./bundle.cjs')` time (the loader fails open, silently
    // dropping every hook). No bundled hook calls a semver fn on the dispatch path
    // (alpha-sort-nudge only wants `naturalCompare`), so a lazy Proxy that defers the
    // real `require('semver')` to first ACCESS keeps the module importable while the
    // never-accessed `new Comparator` never runs. Required since the codemod made
    // the dynamic-import hook eligible → `codeSplitting: false` → semver inlined.
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
  ],
}

export default config
