/**
 * @file Squash-history published-release safeguard. The squash-history runner
 *   collapses a fleet repo's default branch to a single git root — safe for a
 *   repo whose crates.io / npm names are still 0.0.0 PLACEHOLDERS, but a
 *   full-root squash on a repo that has cut a REAL release orphans that
 *   published history. A published repo instead FREEZES: every commit up to
 *   and including its newest published-release commit stays byte-identical,
 *   and only the range above that boundary (`newestRelease..HEAD`) collapses —
 *   `resolveFreezeBoundary` is the pure decision of WHERE that boundary sits.
 *   `publishedReleaseBlocksSquash` stays the thin per-package/per-crate
 *   predicate: real version or not. The runner does every impure lookup
 *   (registry reads, `git merge-base --is-ancestor`) and hands the results
 *   here — anchors plus their pre-computed ancestry — so the boundary
 *   decision itself is deterministic and unit-testable without a network.
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

/**
 * One candidate freeze boundary: the source commit a published npm/crates.io
 * release resolves to (npm packument `gitHead`, crates.io
 * `.cargo_vcs_info.json` `git.sha1` via `crate-release-sha.mts`), or `sha:
 * undefined` when the registry confirms a REAL release exists but no source
 * commit could be read for it (missing `gitHead`, an unreadable crate
 * archive). `source` is a human label (`npm:<name>@<version>`,
 * `crate:<name>@<version>`) used only for error messages.
 */
export interface FreezeAnchorCandidate {
  readonly sha: string | undefined
  readonly source: string
}

/**
 * Pre-computed ancestry for one candidate SHA against the branch tip being
 * squashed: whether it is an ancestor at all (an off-lineage tag/gitHead —
 * resolved but NOT reachable from the tip — is the socket-mcp trap this
 * rejects), and its `distance` (`git rev-list --count <sha>..<tip>`) used to
 * rank multiple verified anchors — smaller distance is NEWER (closer to the
 * tip).
 */
export interface FreezeAncestryInfo {
  readonly distance: number
  readonly isAncestor: boolean
}

export interface ResolveFreezeBoundaryConfig {
  /**
   * Every anchor candidate this repo's manifests declare (one npm package or
   * crate = one candidate), from the root manifest AND every `packages/*` /
   * `crates/*` workspace member.
   */
  readonly candidates: readonly FreezeAnchorCandidate[]
  /**
   * Ancestry info for every candidate's `sha`, keyed by that sha. A candidate
   * whose `sha` has no entry is treated as unverified (same as `isAncestor:
   * false`).
   */
  readonly headAncestry: ReadonlyMap<string, FreezeAncestryInfo>
  /**
   * Whether ANY candidate is a REAL published release (not the `0.0.0`
   * placeholder). Drives the fail-loud branch below — a repo that has never
   * published has no freeze boundary to fail loud about.
   */
  readonly published: boolean
}

/**
 * Resolve the newest ancestor-verified published-release commit — the freeze
 * boundary above which `squashing-history` collapses the tail, or `undefined`
 * when a full-root squash is safe (nothing published).
 *
 * - `published: false` — nothing to freeze; returns `undefined` regardless of
 *   `candidates` (an unreleased repo's candidates, if any, are placeholders).
 * - `published: true` with at least one candidate whose `sha` resolves AND is
 *   ancestor-verified — returns the NEWEST one (smallest `distance`). A
 *   multi-package/multi-crate repo can carry several; the newest across ALL of
 *   them is the boundary, matching the sibling release-probe's "stop at the
 *   first published artifact, but here every one counts" shape.
 * - `published: true` with NO verified candidate (every `sha` is `undefined`, or
 *   every resolved `sha` fails the ancestor check — an off-lineage tag/
 *   gitHead) — THROWS. A repo the registry confirms is published, with no safe
 *   boundary to freeze at, must refuse loudly rather than silently full-
 *   flatten the released history it was meant to protect.
 */
export function resolveFreezeBoundary(
  config: ResolveFreezeBoundaryConfig,
): string | undefined {
  const cfg = { __proto__: null, ...config } as ResolveFreezeBoundaryConfig
  const { candidates, headAncestry, published } = cfg
  if (!published) {
    return undefined
  }
  // Ranks candidates by `distance` alone, which assumes a LINEAR history —
  // the fleet's squash discipline keeps every default branch linear (no merge
  // commits), so "smaller distance" and "newer" always agree. On a non-linear
  // (merged) history, two parallel package anchors can sit at incomparable
  // positions, and the smaller `rev-list --count` distance is not necessarily
  // the more recent one — a repo that ever merges branches into its default
  // branch would need a topological (not distance) comparison here.
  let newestSha: string | undefined
  let newestDistance = Number.POSITIVE_INFINITY
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const { sha } = candidates[i]!
    if (sha === undefined) {
      continue
    }
    const ancestry = headAncestry.get(sha)
    if (!ancestry || !ancestry.isAncestor) {
      continue
    }
    if (ancestry.distance < newestDistance) {
      newestSha = sha
      newestDistance = ancestry.distance
    }
  }
  if (newestSha === undefined) {
    const sources = candidates.map(c => c.source).join(', ') || '(none)'
    throw new Error(
      'resolveFreezeBoundary: this repo has a published release but no ' +
        'safe freeze boundary could be resolved.\n' +
        `  Where: candidate release anchors: ${sources}.\n` +
        '  Saw: every candidate either has no recorded source commit (a ' +
        'missing npm gitHead / crates.io .cargo_vcs_info.json), or its ' +
        'commit is not an ancestor of the branch being squashed (an ' +
        'off-lineage tag/gitHead — the same trap that resolved v0.0.20 into ' +
        'replaced history on socket-mcp, 2026-07-10).\n' +
        '  Wanted: at least one ancestor-verified release anchor to freeze at.\n' +
        '  Fix: refusing rather than silently full-flattening a published ' +
        'release — investigate the registry/gitHead mismatch before ' +
        'squashing.',
    )
  }
  return newestSha
}
