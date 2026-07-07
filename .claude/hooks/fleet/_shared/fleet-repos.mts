/*
 * @file Fleet-repo membership, shared by the hooks that need to know "is this
 *   one of ours?":
 *
 *   - `cross-repo-guard` — blocks `../<fleet-repo>/…` sibling-path imports.
 *   - `no-non-fleet-push-guard` — blocks `git push` to a repo not in the fleet
 *     (a non-fleet repo never has the fleet hook chain installed, so the guard
 *     lives agent-side and must know the roster itself).
 *
 *   Membership DERIVES from the canonical roster
 *   (`cascading-fleet/lib/fleet-repos.json`) — the single source of truth for
 *   the fleet. Do NOT hand-maintain a second list here: add/remove repos in that
 *   JSON. The consumers (cross-repo-guard, no-non-fleet-push-guard, …) run as
 *   per-hook `.mts` — NOT in the dispatch bundle — so Node resolves this JSON
 *   import at load. (Were a consumer ever bundled, rolldown would inline the JSON
 *   so bundle code still never reads the file at runtime.) See
 *   docs/agents.md/fleet/single-source-of-truth.md. A repo that should be a fleet
 *   member WITHOUT being a cascade target is expressed as a field in that JSON,
 *   never as a divergent array here.
 */

import fleetRosterJson from '../../../skills/fleet/cascading-fleet/lib/fleet-repos.json' with { type: 'json' }

// All under the SocketDev org; names match the GitHub repo slug
// (`github.com:SocketDev/<name>`). Sorted for stable diffs — membership lookups
// are order-independent (see FLEET_REPO_SET).
export const FLEET_REPO_NAMES: readonly string[] = fleetRosterJson.repos
  .map(repo => repo.name)
  .toSorted()

const FLEET_REPO_SET: ReadonlySet<string> = new Set(FLEET_REPO_NAMES)

/**
 * True when `slug` (a bare repo name like `socket-cli`) is a fleet member.
 * Case-insensitive — GitHub slugs are case-insensitive and remotes can be typed
 * in any case.
 */
export function isFleetRepo(slug: string): boolean {
  return FLEET_REPO_SET.has(slug.toLowerCase())
}

/**
 * Extract the bare repo slug from a git remote URL, or `undefined` when the URL
 * isn't a recognizable GitHub remote. Handles the three forms git emits:
 *
 * Git@github.com:SocketDev/socket-cli.git (SSH scp-like)
 * ssh://git@github.com/SocketDev/socket-cli.git (SSH URL)
 * https://github.com/SocketDev/socket-cli.git (HTTPS, optional .git)
 *
 * Returns the slug only (`socket-cli`), lowercased. The owner is dropped on
 * purpose: membership is keyed on the repo name, and a fork under a different
 * owner is still not a fleet push target.
 */
export function slugFromRemoteUrl(url: string): string | undefined {
  const trimmed = url.trim()
  if (!trimmed) {
    return undefined
  }
  // Capture `<owner>/<repo>` from any of the three remote shapes, then
  // strip a trailing `.git`. The `[^/:]+` owner segment is bounded by the
  // `:` (scp form) or `/` (URL forms) that precedes it.
  const match = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(trimmed)
  if (!match) {
    return undefined
  }
  return match[2]!.toLowerCase()
}

/**
 * Like {@link slugFromRemoteUrl}, but returns the case-preserved `owner/repo`
 * (e.g. `PerryTS/perry`), or `undefined` when the URL isn't a recognizable
 * GitHub remote. Owner is KEPT (unlike the membership slug, which drops it) so
 * a scoped bypass can be matched against the exact `owner/repo` the user sees.
 */
export function ownerRepoFromRemoteUrl(url: string): string | undefined {
  const trimmed = url.trim()
  if (!trimmed) {
    return undefined
  }
  // Same URL pattern as slugFromRemoteUrl: match the owner and repo segments
  // separated by `/` after a `:` or `/` host delimiter, with an optional
  // `.git` suffix consumed at the end. Both captures are returned joined.
  const match = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(trimmed)
  if (!match) {
    return undefined
  }
  return `${match[1]!}/${match[2]!}`
}
