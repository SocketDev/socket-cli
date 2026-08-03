/**
 * @file Rolldown build for the snapshot-EXCLUDED hooks bundle. Sibling of
 *   `hook-bundle-snapshot.config.mts`: hooks tagged
 *   `@dispatch-snapshot-exclude` can't be frozen into the V8 startup snapshot
 *   (their module-eval graphs hold native [Foreign] handles the serializer
 *   refuses), so they're bundled separately from the generated
 *   `dispatch-table-excluded.mts` and required lazily by the deserialize-main
 *   at runtime. Plain runtime CJS — no snapshot build-pass shims needed —
 *   mirroring the main `hook-bundle.config.mts` (single chunk, unminified,
 *   node: externals, the same lib stubs).
 */

import path from 'node:path'

import type { RolldownOptions } from 'rolldown'

import {
  DISPATCH_DIR,
  EXCLUDED_BUNDLE_PATH,
} from '../../../scripts/fleet/paths.mts'
import { createBundleStubPlugin } from '../../repo/rolldown/bundle-stub.mts'

const config: RolldownOptions = {
  external: [/^node:/],
  input: path.join(DISPATCH_DIR, 'excluded-entry.mts'),
  output: {
    // Single chunk for the same reason as the main bundle: the loader
    // requires ONE file, and lazy runtime import()s must inline.
    codeSplitting: false,
    file: EXCLUDED_BUNDLE_PATH,
    format: 'cjs',
    // Fleet hard rule: never minify, no source maps, auditable output.
    minify: false,
    sourcemap: false,
  },
  platform: 'node',
  plugins: [
    // Same reachability stubs as the main bundle — the excluded hooks run in
    // a plain runtime process, but the glob/sort subgraphs are still dead
    // weight on the dispatch path.
    createBundleStubPlugin({
      stubPattern: /@socketsecurity\/lib(?:-stable)?\/.*\/(?:globs|sorts)\.js$/,
    }),
    // Lazy-semver proxy, same rationale as hook-bundle.config.mts: inlined
    // semver's circular comparator require breaks at module-eval; defer to
    // first access.
    createBundleStubPlugin({
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
