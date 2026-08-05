/**
 * @file Soak-exclude lists for the ecosystems whose package manager has NO
 *   native publish-age gate: Go and Homebrew, whose gates
 *   (`check/go-deps-are-soaked.mts`, `update/brew.mts`) read these lists.
 *   Cargo is deliberately absent — see the note below. A dependency named here
 *   bypasses the `SOAK_DAYS` trust gate for its ecosystem, reserved for
 *   first-party, unpublishable, or deliberately-fresh deps. Every entry is
 *   dated so a stale bypass can't linger, the same discipline the npm
 *   soak-excludes carry (`# published | removable`), enforced by the gate that
 *   reads this file.
 */

export interface SoakExclude {
  // The identifier as it appears in the manifest: a go module path or a brew
  // formula/cask token.
  readonly name: string
  // Why it bypasses soak, plus the date it became removable (YYYY-MM-DD) so the
  // exclusion doesn't outlive its reason.
  readonly reason: string
}

// There is deliberately NO cargo list here. Rust enforces soak natively with
// nightly `-Zmin-publish-age` (RFC 3923), configured in `.cargo/config.toml`
// via `[registry] global-min-publish-age` and `[resolver]
// incompatible-publish-age = "deny"`. Cargo exposes no per-crate exemption
// key; its own escape hatch is the lock, since the resolver admits a too-new
// version only when `Cargo.lock` already pins it — which a one-off
// `CARGO_RESOLVER_INCOMPATIBLE_PUBLISH_AGE=allow` update establishes. So a
// cargo exemption is recorded as a TRACKED LOCK PIN beside the manifest
// comment explaining it, never as an entry here. A list on this side could not
// enforce anything: cargo does the gating and never consults it.

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
