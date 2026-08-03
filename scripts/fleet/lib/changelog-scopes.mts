/**
 * @file The dev-vs-prod scope classification for CHANGELOG entries. A
 *   commit's scope selects which half of the release notes it renders under:
 *   a scope naming internal fleet tooling (hooks, cascade, CI, lint/check
 *   gates, the bootstrap/dispatch machinery, generated bundles, dep/config
 *   plumbing) lands under the version's `### Internal` subsection instead of
 *   the consumer-facing Added/Changed/Fixed. A consumer scope (`cli`, `api`,
 *   `sdk`, a shipped feature) or no scope at all is prod — internal tooling
 *   has to name itself here to opt IN, a shipped feature never has to opt
 *   out. `changelog.mts`'s `generateChangelogSection` is the sole caller.
 */

// Confirmed dev-scope list — every other scope (and a scopeless commit) is
// prod. Sorted (sort-set-args).
export const DEV_SCOPES: ReadonlySet<string> = new Set([
  'bootstrap',
  'bundle',
  'cascade',
  'check',
  'ci',
  'config',
  'deps',
  'dispatch',
  'fleet',
  'gitignore',
  'hooks',
  'lint',
  'wheelhouse',
])

// The subsection a dev-scoped bullet renders under. Kept out of
// changelog-render.mts's SECTION_ORDER (Added / Changed / Fixed) so
// `renderSectionMap` emits it after those, and only when a version carries at
// least one dev-scope bullet.
export const INTERNAL_SECTION = 'Internal'

/**
 * True when `scope` names internal fleet tooling rather than a
 * consumer-facing surface. `undefined` — a scopeless commit — is prod by
 * construction.
 */
export function isDevScope(scope: string | undefined): boolean {
  return scope !== undefined && DEV_SCOPES.has(scope)
}
