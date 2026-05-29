/**
 * @file Single source of truth for fleet-repo membership, shared by the hooks
 *   that need to know "is this one of ours?":
 *
 *   - `cross-repo-guard` — blocks `../<fleet-repo>/…` sibling-path imports.
 *   - `no-non-fleet-push-guard` — blocks `git push` to a repo not in the fleet (a
 *     non-fleet repo never has the fleet hook chain installed, so the guard has
 *     to live agent-side and know the roster itself). This is the BROAD
 *     membership set, intentionally wider than the cascade roster in
 *     `cascading-fleet/lib/fleet-repos.json` (which lists only template-cascade
 *     targets and omits e.g. `ultrathink`). Membership here answers "may fleet
 *     tooling act on this repo at all", not "does the wheelhouse cascade into
 *     it". Keep the two distinct: a repo can be a fleet member (pushable,
 *     importable) without being a cascade target.
 */

// All under the SocketDev org. Names match the GitHub repo slug
// (`github.com:SocketDev/<name>`). Sorted; add new fleet repos here and
// both consuming guards pick them up.
export const FLEET_REPO_NAMES = [
  'claude-code',
  'skills',
  'socket-addon',
  'socket-btm',
  'socket-cli',
  'socket-lib',
  'socket-packageurl-js',
  'socket-registry',
  'socket-sdk-js',
  'socket-sdxgen',
  'socket-stuie',
  'socket-vscode',
  'socket-webext',
  'socket-wheelhouse',
  'ultrathink',
] as const

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
