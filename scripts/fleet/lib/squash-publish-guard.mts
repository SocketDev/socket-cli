/**
 * @file Squash-history published-release safeguard. The squash-history runner
 *   collapses a fleet repo's default branch to a single git root — safe for a
 *   repo whose crates.io / npm names are still 0.0.0 PLACEHOLDERS, but it
 *   ERASES published-release history for a repo that has cut a REAL release.
 *   A published repo must instead KEEP its history and consolidate only the
 *   range since its last publish (`git reset --soft <publish-sha>`), so the
 *   runner refuses a full-root squash the moment this predicate reports a
 *   block. Pure over (publishes-profile, latest-registry-version): the runner
 *   does the registry read (fail-open, so a read error never blocks a legit
 *   squash) and hands the result here for the yes/no verdict, so the decision
 *   is deterministic and unit-testable without a network.
 */

/**
 * The reserved pre-release version a fleet repo carries before its first real
 * publish. A repo still at this version has only placeholders on the registry,
 * so a full-root squash erases no published-release history.
 */
export const PLACEHOLDER_VERSION = '0.0.0'

/**
 * A refuse-the-squash verdict: the registry and the real version whose
 * published-release history a full-root squash would erase.
 */
export interface PublishBlock {
  readonly registry: 'crates.io' | 'npm'
  readonly version: string
}

/**
 * Whether a published release blocks a full-root squash of this repo.
 *
 * Returns a `PublishBlock` when the repo has a REAL published release whose
 * history the squash would erase, and `undefined` when the squash is safe:
 *
 * - No version, or the placeholder version (`0.0.0`) — nothing published yet, so
 *   the squash erases nothing; returns undefined.
 * - `publishes === 'cargo'` + a real version — `{registry:'crates.io', version}`.
 * - `publishes === 'js'` or `'npm'` + a real version — `{registry:'npm',
 *   version}`. `'js'` is the fleet roster's value for npm packages; `'npm'` is
 *   accepted too so the predicate holds for either spelling.
 * - Any other profile (binary / none / unset) — undefined; a binary / unpublished
 *   repo has no registry package whose release history a squash could erase.
 *
 * @param publishes The repo's `publishes` roster profile
 *   (`cargo` | `js` | `npm` | `binary` | `none` | …), or undefined when unset.
 * @param version The latest version the registry reports for this repo, or
 *   undefined when the repo is unpublished / the lookup failed.
 */
export function publishedReleaseBlocksSquash(
  publishes: string | undefined,
  version: string | undefined,
): PublishBlock | undefined {
  if (!version || version === PLACEHOLDER_VERSION) {
    return undefined
  }
  if (publishes === 'cargo') {
    return { __proto__: null, registry: 'crates.io', version } as PublishBlock
  }
  if (publishes === 'js' || publishes === 'npm') {
    return { __proto__: null, registry: 'npm', version } as PublishBlock
  }
  return undefined
}
