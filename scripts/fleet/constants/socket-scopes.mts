/**
 * @file Socket-owned package scope patterns that bypass the fleet's soak /
 *   maturity windows. The cooldown (7-day soak on npm `minimumReleaseAge`,
 *   matching `maturityPeriod` on taze, matching GitHub-release soak in
 *   update-external-tools) exists to catch compromised upstream packages before
 *   adoption. Socket-published packages go through our own provenance pipeline
 *   (OIDC trusted publisher, sigstore attestations, manual approve gate) so we
 *   trust them to ship fresh. Fleet-tier (cascaded) so both wheelhouse-only
 *   scripts AND cascaded checks share one canonical list. Consumers:
 *
 *   1. `.config/fleet/taze.config.mts` — `exclude:` for pass 1
 *      (cooldown-respecting) / re-included in pass 2 (immediate-bump).
 *   2. `scripts/repo/update-external-tools.mts` — bypasses GitHub-release soak
 *      when the tool's `repository: 'github:owner/repo'` owner is a SocketDev
 *      org (see `isSocketSourcedRepository`).
 *   3. `pnpm-workspace.yaml` `minimumReleaseAgeExclude:` — kept in lockstep with
 *      this list by the sync-scaffolding manifest (which spreads
 *      `SOCKET_PACKAGE_PATTERNS`), since pnpm reads YAML directly and can't
 *      import this module. Keep the lists alphabetized per the fleet
 *      `socket/sort-*` convention.
 *   4. `scripts/fleet/check/soak-excludes-have-dates.mts` — exempts a Socket-owned
 *      scope glob / bare name from the version-pin requirement (third-party
 *      entries must pin `name@version`).
 */

/**
 * Npm-scope and exact-name patterns that mark a package as Socket-published.
 * Used by taze (glob exclude) and pnpm (minimumReleaseAgeExclude). Match
 * semantics: scope wildcards (`@scope/*`) match every package under a scope WE
 * own; an UNSCOPED name (`sfw`, `socket`) matches EXACTLY. Unscoped prefix
 * globs are forbidden (a `socket-*` glob would soak-bypass any attacker's
 * `socket-…`); the load-time invariant below enforces that.
 */
export const SOCKET_PACKAGE_PATTERNS: readonly string[] = [
  // SCOPED globs are safe: an `@scope/*` wildcard only ever admits packages
  // published under a scope WE own on npm, so a soak-bypass can't be abused by
  // an attacker squatting a name. Bare/unscoped patterns are NOT listed as a
  // prefix glob (`socket-*` would soak-bypass any attacker-published
  // `socket-<anything>`) — every non-scoped Socket package is named EXACTLY.
  '@socketaddon/*',
  '@socketbin/*',
  '@socketdev/*',
  '@socketoverride/*',
  '@socketregistry/*',
  '@socketsecurity/*',
  // Socket-owned project scopes published from fleet repos: @stuie (socket-bin
  // + socket-mcp tooling), @ultrathink (acorn meta + per-platform binaries).
  '@stuie/*',
  '@ultrathink/*',
  // Unscoped Socket packages — named exactly, never a `socket-*` prefix glob
  // (that would bypass the soak for any attacker-published `socket-…` name).
  // `socket` is the live CLI; `sfw` is Socket Firewall. (`socket-cli` +
  // `socket-mcp` are deprecated / renamed to @socketsecurity/* — not listed.)
  'sfw',
  'socket',
]

/**
 * GitHub organizations whose releases are Socket-published and bypass the soak
 * window in `update-external-tools.mts`. Matched against the `owner` segment of
 * an `external-tools.json` entry's `repository: 'github:owner/repo'` field.
 * `SocketDev` is the canonical fleet org; aliases are listed for completeness
 * and so the rename to a single org (whenever that happens) is mechanical.
 */
export const SOCKET_GITHUB_ORGS: readonly string[] = ['SocketDev']

/**
 * Return true when an `external-tools.json` entry's `repository:` field points
 * at a Socket-owned GitHub org. Accepts either the prefixed shape
 * (`github:SocketDev/repo`) or the bare shape (`SocketDev/repo`); strips any
 * leading `github:` before splitting on `/`. Case-insensitive on the org
 * segment so `socketdev/repo` matches too.
 */
export function isSocketSourcedRepository(repository: string): boolean {
  const stripped = repository.startsWith('github:')
    ? repository.slice(7)
    : repository
  const slash = stripped.indexOf('/')
  if (slash === -1) {
    return false
  }
  const owner = stripped.slice(0, slash).toLowerCase()
  for (let i = 0, { length } = SOCKET_GITHUB_ORGS; i < length; i += 1) {
    if (SOCKET_GITHUB_ORGS[i]!.toLowerCase() === owner) {
      return true
    }
  }
  return false
}

/**
 * Security invariant: only SCOPED globs (`@scope/*`) are allowed to wildcard —
 * an `@scope/*` only ever admits packages under an npm scope WE own, so the
 * soak-bypass can't be abused. An UNSCOPED prefix glob (`socket-*`) would
 * soak-bypass any package an attacker publishes as `socket-<anything>`, so it
 * is forbidden — assert at load so a future edit can't smuggle one in. Every
 * unscoped Socket package is listed by its EXACT name instead.
 */
for (let i = 0, { length } = SOCKET_PACKAGE_PATTERNS; i < length; i += 1) {
  const pattern = SOCKET_PACKAGE_PATTERNS[i]!
  if (pattern.includes('*') && !pattern.startsWith('@')) {
    throw new Error(
      `[socket-scopes] SOCKET_PACKAGE_PATTERNS entry "${pattern}" is an ` +
        `unscoped wildcard, which would soak-bypass any attacker-published ` +
        `package matching it. Only @scope/* globs may wildcard; name every ` +
        `unscoped Socket package exactly (e.g. "socket-cli", not "socket-*").`,
    )
  }
}

/**
 * Return true when an npm purl (or bare package name) matches a Socket-owned
 * pattern. Accepts purl form (`pkg:npm/@socketsecurity/lib@6.0.6`) or bare name
 * (`@socketsecurity/lib`). Match shape: `@scope/*` matches any package under
 * the scope; every other (unscoped) pattern matches by EXACT name — there are
 * no unscoped prefix globs (see the security invariant above).
 */
export function isSocketSourcedPackage(purlOrName: string): boolean {
  // Extract the package name from a purl: `pkg:npm/<name>@<version>`
  let name = purlOrName
  if (name.startsWith('pkg:npm/')) {
    name = name.slice(8)
    const at = name.lastIndexOf('@')
    if (at > 0) {
      name = name.slice(0, at)
    }
  }
  for (let i = 0, { length } = SOCKET_PACKAGE_PATTERNS; i < length; i += 1) {
    const pattern = SOCKET_PACKAGE_PATTERNS[i]!
    if (pattern.endsWith('/*')) {
      const scope = pattern.slice(0, -2)
      if (name.startsWith(`${scope}/`)) {
        return true
      }
    } else if (name === pattern) {
      return true
    }
  }
  return false
}
