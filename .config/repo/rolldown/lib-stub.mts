/**
 * @file Rolldown plugin: stub heavy `@socketsecurity/lib-stable` internals that
 *   runtime code never reaches. Why: `@socketsecurity/lib-stable` is the
 *   canonical fleet utility surface, but its module graph statically pulls in
 *   heavyweight files (e.g. globs.js → picomatch ~260KB, sorts.js → semver +
 *   npm-pack ~2.5MB) along import paths that real consumers never traverse.
 *   Tree-shaking can't drop unreachable subgraphs that look reachable to the
 *   static analyzer; we have to tell it explicitly. Each consumer passes a
 *   `stubPattern` regex matching the absolute resolved paths of the unreachable
 *   files for THEIR import surface. Verify reachability before adding a pattern
 *   — stubbing a file that IS reached at runtime gives runtime crashes, not
 *   bundle-time errors. Source: lifted from socket-packageurl-js's inline
 *   plugin (.config/repo/rolldown.config.mts), generalized so the stub-pattern
 *   is caller-provided. Fleet-canonical via socket-wheelhouse.
 */

import type { Plugin } from 'rolldown'

export type LibStubConfig = {
  /**
   * Regex matched against resolved module paths. Files matching get replaced
   * with an empty CJS module. Required.
   */
  readonly stubPattern: RegExp
  /**
   * Replacement code. Defaults to `module.exports = {}`. Override only if you
   * need a non-empty stub (rare).
   */
  readonly stubCode?: string | undefined
}

export function createLibStubPlugin(config: LibStubConfig): Plugin {
  const { stubCode = 'module.exports = {}', stubPattern } = {
    __proto__: null,
    ...config,
  } as LibStubConfig
  return {
    name: 'stub-unused-lib-internals',
    load(id) {
      if (stubPattern.test(id)) {
        return { code: stubCode, moduleSideEffects: false }
      }
      return undefined
    },
  }
}
