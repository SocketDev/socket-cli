/*
 * @file Tag-name shapes shared by the release guards. A release tag and a
 *   floating alias look alike to a naive scan, and telling them apart is what
 *   decides whether a `git tag` invocation is a release step at all:
 *
 *   - `vX.Y.Z` is a RELEASE tag. Cutting one by hand is what
 *     release-defers-to-script-guard and version-bump-order-guard exist to
 *     block, because the release scripts own that step end to end.
 *   - `vX` / `vX.Y` is a floating ALIAS. Moving one onto an already-published
 *     release is post-release pointer maintenance, not a release: the version
 *     exists, the notes exist, the alias just follows. GitHub keeps the two
 *     apart the same way — `actions/checkout` cuts releases from its release
 *     flow and moves `v4`/`v5` from a separate `update-main-version.yml`
 *     dispatch.
 *
 *   The distinction has to read the tag being WRITTEN, which for `git tag` is
 *   the first positional. Anything after it is the commit-ish being READ, so a
 *   scan that accepts any version-shaped argument misfires on
 *   `git tag -f v1 v1.3.2` — the alias move — and demands a release ceremony
 *   for it.
 */

// A release tag: optional `v`, then a full semver, with an optional prerelease
// or build suffix. Anchored so a tag message like `1.2.3 ships` never matches.
const RELEASE_TAG_NAME_RE = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

// A floating alias: `<major>` or `<major>.<minor>`, `v` optional, never a full
// semver. The bare form exists as a backstop: GitHub records release
// immutability ON THE TAG and does not lift it when the release is deleted, so
// a `v<major>` alias that ever carried a release is frozen forever. A bare
// `<major>` is a fresh ref that can still track its line. At most two numeric
// segments, so a release tag never reads as an alias.
const ALIAS_TAG_NAME_RE = /^v?\d+(?:\.\d+)?$/

/**
 * Strip a `refs/tags/` lead so a fully-qualified refspec resolves the same as a
 * bare tag name.
 */
export function bareTagName(ref: string): string {
  return ref.startsWith('refs/tags/') ? ref.slice('refs/tags/'.length) : ref
}

/**
 * True when `ref` names a release tag (`v1.2.3`, `1.2.3`, `v1.2.3-rc.1`).
 */
export function isReleaseTagName(ref: string): boolean {
  return RELEASE_TAG_NAME_RE.test(bareTagName(ref))
}

/**
 * True when `ref` names a floating alias tag (`v1`, `v1.3`) rather than a
 * release. A full semver is never an alias.
 */
export function isAliasTagName(ref: string): boolean {
  return ALIAS_TAG_NAME_RE.test(bareTagName(ref))
}

/**
 * The first positional token in `args`, skipping flags and the values of
 * `valueFlags`. For `git tag` that token is the tag being written.
 */
export function firstPositionalArg(
  args: readonly string[],
  valueFlags: ReadonlySet<string>,
): string | undefined {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (arg.startsWith('-')) {
      if (valueFlags.has(arg)) {
        i += 1
      }
      continue
    }
    return arg
  }
  return undefined
}

/**
 * True when a `git tag` argument list writes a floating alias — the case both
 * release guards must let through.
 */
export function writesAliasTag(
  args: readonly string[],
  valueFlags: ReadonlySet<string>,
): boolean {
  const written = firstPositionalArg(args, valueFlags)
  return written !== undefined && isAliasTagName(written)
}
