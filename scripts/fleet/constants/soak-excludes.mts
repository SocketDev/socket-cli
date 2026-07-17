/**
 * @file Canonical per-ecosystem soak-exclude lists. A dependency named here
 *   bypasses the `SOAK_DAYS` trust gate for its ecosystem — reserved for
 *   first-party, unpublishable, or deliberately-fresh deps. Every soak gate
 *   (cargo / go / brew) consults these, so an exclusion lives in ONE place.
 *   Mirrors the npm surface: `SOCKET_SCOPES` + pnpm-workspace
 *   `minimumReleaseAgeExclude`, where Socket-published scopes bypass the
 *   cooldown because they go through our own provenance pipeline. Same shape,
 *   other ecosystems. Every entry is dated so a stale bypass can't linger — the
 *   same discipline the npm soak-excludes carry (`# published | removable`),
 *   enforced by the gate that reads this file.
 */

export interface SoakExclude {
  // The identifier as it appears in the manifest: a go module path, a crate
  // name, or a brew formula/cask token.
  readonly name: string
  // Why it bypasses soak, plus the date it became removable (YYYY-MM-DD) so the
  // exclusion doesn't outlive its reason.
  readonly reason: string
}

// Rust crates that bypass the cargo min-publish-age gate.
export const CARGO_SOAK_EXCLUDES: readonly SoakExclude[] = []

// Go modules that bypass the go publish-age gate.
export const GO_SOAK_EXCLUDES: readonly SoakExclude[] = []

// Homebrew formulae / casks that bypass the brew tap-pin soak gate.
export const BREW_SOAK_EXCLUDES: readonly SoakExclude[] = []

/**
 * True when `name` is soak-excluded in the given ecosystem's list.
 */
export function isSoakExcluded(
  excludes: readonly SoakExclude[],
  name: string,
): boolean {
  for (let i = 0, { length } = excludes; i < length; i += 1) {
    if (excludes[i]!.name === name) {
      return true
    }
  }
  return false
}
